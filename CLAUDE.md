# walmart-mcp-suite — project conventions

Read this first when assisting with this codebase.

## What this is

A monorepo of MCP (Model Context Protocol) servers and shared libraries for the **Walmart Global Marketplace API**. Multi-market by design — us / mx / ca / cl. TypeScript, Node ≥ 20, npm workspaces.

Currently published: `@walmart-mcp/listing-server` (23 typed tools). Planned siblings: orders-mcp / fulfillment-mcp / reports-mcp / ads-mcp.

## Monorepo layout

```
walmart-listing-mcp/                ← root (npm workspaces)
├── package.json                    ← workspaces: ["packages/*", "servers/*"]
├── tsconfig.base.json              ← shared compiler options
├── packages/
│   ├── client/                     ← @walmart-mcp/client (HTTP + OAuth + WM_MARKET injection)
│   ├── profiles/                   ← @walmart-mcp/profiles (sellerProfile store with market enum)
│   ├── types/                      ← @walmart-mcp/types (WalmartMarket, MARKET_CURRENCY, WM_GLOBAL_VERSION)
│   └── test-utils/                 ← @walmart-mcp/test-utils (skeleton)
└── servers/
    └── listing-mcp/                ← @walmart-mcp/listing-server
        ├── src/
        ├── scripts/                ← smoke tests + probe-*.mjs
        ├── tests/                  ← (empty after v1.0.0 extraction; tests live in their respective packages)
        ├── docs/
        ├── evaluation/             ← mcp-builder Phase 4 suite
        └── examples/               ← claude-settings.json, codex-config.toml templates
```

Build commands (run from root). Build BEFORE typecheck — workspaces resolve
each other through their emitted `dist/*.d.ts`, so the declarations must exist
first. Root scripts run workspaces in dependency order (types → client →
profiles → test-utils → servers), not the alphabetical order npm uses by default.
```
npm run build         # 6 workspaces, dependency order
npm run typecheck     # 6 workspaces (needs a prior build)
npm test              # runs vitest in each workspace that has tests
```

Smoke test (requires built listing-server dist):
```
cd servers/listing-mcp && node scripts/smoke-test.mjs
```

## Architecture invariants — do not violate

### 1. One tool per Walmart endpoint
No wildcard / escape-hatch tools. v0.2.0 deliberately removed the old `walmart_invoke_listing_api` so the LLM cannot be coerced into hitting arbitrary endpoints via prompt injection. Every new capability gets a dedicated tool wrapping exactly one endpoint.

**Exceptions** — composite tools are OK if clearly named `*_complete_*` or `*_diagnose_*` and use `Promise.allSettled` (partial failures must not fail the call). Example: `walmart_get_complete_item`.

### 2. registerTool options-object pattern
All tools use:

```ts
registerTool(server, {
  name: "walmart_...",
  description: "...",
  annotations: <preset>,        // ← visually adjacent to name
  inputSchema: z.object({ ... }).strict(),
  outputSchema: <shape>,
  handler: async (input) => withClient(input.sellerProfileId, async (client) => ...),
});
```

Never positional args. Never inline annotations object — use one of the 5 named presets.

### 3. Five annotation presets — use them, don't invent new ones

| Preset | When |
|---|---|
| `READ_LOCAL` | Reads only local profile store, no network |
| `READ_REMOTE` | GETs from Walmart API |
| `WRITE_LOCAL_DESTRUCTIVE` | Overwrites local state (e.g. upsert_seller_profile replaces credentials) |
| `WRITE_LOCAL_SAFE` | Flips a local flag, fully reversible (e.g. set_active_seller_profile) |
| `WRITE_REMOTE_IDEMPOTENT` | Idempotent Walmart writes (same input → same end state) |
| `WRITE_REMOTE_NONIDEMPOTENT` | Creates new resources per call (e.g. submit_feed creates new feedId each time) |

Per MCP spec, READ_* presets omit `destructiveHint` / `idempotentHint` (they only have meaning when `readOnlyHint: false`).

### 4. Strict input + permissive output schemas
- Inputs: `.strict()` on every `z.object()` so unknown params reject before any API call.
- Outputs: known top-level fields typed permissively (`z.unknown()` for nested variable shapes; `z.union([z.number(), z.string()])` for IDs/amounts), wrapped in `.passthrough()`. Walmart returns inconsistent types across responses — schemas that are too strict cause `MCP error -32602 Output validation` failures.

### 5. Prompt-injection wrapping for external content
`serializeSuccess(value, source)` takes `'local' | 'external'`. `READ_REMOTE` / `WRITE_REMOTE_*` annotations automatically thread `source: 'external'` which prefixes the text content with `UNTRUSTED_PREFIX` and adds `_source: UNTRUSTED_SOURCE_MARKER` to structured content. Both constants live in `packages/client/src/format.ts`. Do not duplicate string literals — import from `@walmart-mcp/client`.

### 6. WM_MARKET routing — required for v1.0.0+
Every `WalmartClient` instance carries a `WalmartMarket` (us|mx|ca|cl). The client middleware automatically attaches:
- `WM_MARKET: <market>` header on the token call AND every API call
- `WM_GLOBAL_VERSION: 3.1` header

OAuth token cache key is scoped to `(svcEnv, market, profile)` — never share a token across markets even when the underlying clientId is the same. The market comes from the active `sellerProfile`. Never hard-code a market in a tool or client invocation.

### 7. Market guards on US-only tools
Tools whose Walmart endpoint exists only in US Marketplace (Insights data-science backbone) must call `assertMarketAllowed(profileId, ["us"], toolName)` at the top of their handler. Current US-only set: `walmart_get_listing_quality_score`, `walmart_get_unpublished_counts`. When adding a new US-only tool, add the guard + describe the restriction in the tool description.

## Sandbox vs production divergence

**Sandbox is mock-like for writes AND reads in many cases** — `update_inventory` / `update_price` / `retire_item` return success for ANY SKU regardless of ownership. `get_items` returns the same 12-item mock dataset regardless of `WM_MARKET`. Several endpoints work in sandbox but error in production with different shapes (`search_my_catalog`, `get_departments`, `get_unpublished_counts`). Known issues listed in README "Known production issues" section.

**Never assume sandbox behavior == production behavior.** Probe in sandbox first; document any prod-specific issues empirically when users report them.

## Probe-first discovery pattern

When adding a new tool or debugging a Walmart endpoint:

1. Write `servers/listing-mcp/scripts/probe-<thing>.mjs` (sandbox-guarded via `requireSandbox` helper from `_helpers.mjs`)
2. **Verify the URL against Walmart's official docs first** — `developer.walmart.com/global-marketplace/...` or `developer.walmart.com/api-list`. Do not guess paths; v0.5.0 shipped 7 fake-path tools because a subagent guessed URLs.
3. Try ≥ 5 candidate variants (different body shapes, methods, paths) in sequence
4. Identify which variant returns 200 with usable data
5. Codify that shape in `packages/client/src/walmart-client.ts` and `servers/listing-mcp/src/service/walmart-tools.ts`
6. Add a smoke-test assertion in `scripts/smoke-test-api.mjs`
7. Commit the probe script as documentation-via-code

Existing probes worth reading: `probe-which-market.mjs` (identifies which markets a credential accepts), `probe-global-multi-market.mjs` (validates Global API multi-market routing end-to-end), `probe-v052.mjs` (corrected-path follow-ups after v0.5.1's path-guessing mistakes).

## Release cycle

Every meaningful change ships through this rhythm:

```
1. Branch              git checkout -b <type>/<version>-<topic>
2. Implement           code + tests + docs
3. Local verify        npm run build && npm run typecheck && npm test
4. Sandbox verify      cd servers/listing-mcp && node scripts/smoke-test.mjs
                       node scripts/smoke-test-api.mjs       # reads
                       node scripts/smoke-test-writes.mjs    # writes (sandbox only)
5. Bump version        servers/listing-mcp/package.json + src/index.ts
6. Commit              detailed message: bugs found, fixes applied, verification
7. Push + PR           gh pr create with full diff context
8. Merge + release     gh pr merge --merge --delete-branch
                       gh release create v<x.y.z> --notes "..."
9. Cleanup secrets     rm .env  (always — never leave creds on disk)
```

Skip steps only with explicit user direction.

## Smoke test layers — all must stay green

| Script | Creds | Asserts |
|---|---|---|
| `servers/listing-mcp/scripts/smoke-test.mjs` | None | Tool inventory (23), annotations, output schema, strict-schema rejection, local trust routing |
| `servers/listing-mcp/scripts/smoke-test-api.mjs` | Sandbox | Real OAuth + read tools end-to-end |
| `servers/listing-mcp/scripts/smoke-test-writes.mjs` | Sandbox | Write tools happy + error + schema-rejection paths (incl. typed-arg validators) |

Combined target: **all green** before any commit lands on `main`.

## Secrets handling

- `.env` is gitignored. Always delete it before committing — `git status` should never show `.env` as untracked-but-about-to-be-staged.
- Never echo `WALMART_CLIENT_SECRET` or `ANTHROPIC_API_KEY` to stdout. Pass via env, read via `dotenv/config`.
- `format.ts:redactValue` strips keys matching `secret|password|token|authorization|access_key|api_key|client_secret` — relies on this for error redaction. Don't bypass.
- Solutions Provider credentials are particularly sensitive — one credential gives access across multiple markets.

## Documentation hierarchy

| File | Audience |
|---|---|
| `README.md` (root) | Anyone discovering the monorepo |
| `servers/listing-mcp/docs/QUICKSTART.md` / `QUICKSTART_EN.md` | New installer (5 min path) |
| `servers/listing-mcp/docs/MCP_SETUP_CN.md` | Full reference for tool catalog + multi-profile + troubleshooting |
| `servers/listing-mcp/docs/PRODUCTION_VALIDATION.md` | Required reading before any production credential is used |
| `servers/listing-mcp/scripts/README.md` | Operators of the smoke/probe scripts |
| `servers/listing-mcp/evaluation/README.md` | mcp-builder Phase 4 evaluation suite usage |
| `CLAUDE.md` (this file) | Claude Code sessions assisting with the codebase |

When adding new features, update the relevant doc(s) **in the same PR**.

## Coding style

- TypeScript strict mode. No `any`; prefer `unknown` + narrowing.
- No comments explaining WHAT obvious code does. Comments only when there's a non-obvious WHY (workaround, surprising constraint, sandbox quirk).
- Imports: ES modules (`.js` extensions in TS imports — required by NodeNext resolution).
- Cross-workspace imports go through package names (`import ... from "@walmart-mcp/client"`), never relative paths into other workspaces.
- Tests: vitest. Each workspace has its own `vitest.config.ts` + `tests/` dir.

## When in doubt

1. Re-read `servers/listing-mcp/scripts/probe-*.mjs` files — they document empirical discoveries about Walmart's API that the official docs don't cover.
2. For market-specific behavior, check `developer.walmart.com/global-marketplace/` first; the per-market reference pages (`/us-marketplace/`, `/mx-marketplace/`, etc.) often contradict each other.
3. Don't trust subagent research that lists URLs without grounding in walmart.com docs — v0.5.0 shipped 7 fake-path tools that way. Always verify by direct WebFetch of `developer.walmart.com`.
