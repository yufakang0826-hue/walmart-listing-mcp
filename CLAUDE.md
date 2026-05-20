# walmart-listing-mcp — project conventions

Read this first when assisting with this codebase.

## What this is

A standalone MCP (Model Context Protocol) server exposing Walmart Marketplace seller listing operations as 21 typed tools. TypeScript, Node ≥ 20, builds to `dist/`. Installed by end users into Codex / Claude Desktop / Claude Code via `.mcp.json` or platform equivalents.

## Architecture invariants — do not violate

### 1. One tool per Walmart endpoint
No wildcard / escape-hatch tools. v0.2.0 deliberately removed the old `walmart_invoke_listing_api` so the LLM cannot be coerced into hitting arbitrary endpoints via prompt injection. Every new capability gets a dedicated tool wrapping exactly one endpoint.

**Exception**: `walmart_get_complete_item` is a composite that orchestrates 4 calls in parallel for ergonomics. Composites are OK if they are clearly named "complete_X" and use `Promise.allSettled` (partial failures must not fail the call).

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
`serializeSuccess(value, source)` takes `'local' | 'external'`. `READ_REMOTE` / `WRITE_REMOTE_*` annotations automatically thread `source: 'external'` which prefixes the text content with `UNTRUSTED_PREFIX` and adds `_source: UNTRUSTED_SOURCE_MARKER` to structured content. Both constants live in `src/helper/format.ts`. Do not duplicate string literals — import from there.

## Sandbox vs production divergence

**Sandbox is mock-like for writes** — `update_inventory` / `update_price` / `retire_item` return success for ANY SKU regardless of ownership. Production is strict. Several endpoints work in sandbox but error in production with different shapes (`search_my_catalog`, `get_departments`). Known issues listed in README "Known production issues" section.

**Never assume sandbox behavior == production behavior.** Probe in sandbox first; document any prod-specific issues empirically when users report them.

## Probe-first discovery pattern

When adding a new tool or debugging a Walmart endpoint:

1. Write `scripts/probe-<thing>.mjs` (sandbox-guarded via `requireSandbox` helper from `_helpers.mjs`)
2. Try ≥ 5 candidate variants (different body shapes, methods, paths) in sequence
3. Identify which variant returns 200 with usable data
4. Codify that shape in `walmart-client.ts` and `walmart-tools.ts`
5. Add a smoke-test assertion in `scripts/smoke-test-api.mjs`
6. Commit the probe script as documentation-via-code

Examples: `probe-taxonomy.mjs` discovered `version=4.2`; `probe-my-catalog.mjs` walked through 14 body shapes; `probe-gaps.mjs` confirmed which gap-closing endpoints don't exist.

## Release cycle

Every meaningful change ships through this rhythm:

```
1. Branch                git checkout -b <type>/<version>-<topic>
2. Implement             code + tests + docs
3. Local verify          npm run typecheck && npm test && npm run build
4. Sandbox verify        node scripts/smoke-test.mjs              # no creds
                         node scripts/smoke-test-api.mjs           # reads
                         node scripts/smoke-test-writes.mjs        # writes (sandbox only)
5. Bump version          package.json + src/index.ts
6. Commit                detailed message: bugs found, fixes applied, verification results
7. Push + PR             gh pr create with full diff context
8. Merge + release       gh pr merge --merge --delete-branch
                         gh release create v<x.y.z> --notes "..."
9. Cleanup secrets       rm .env  (always — never leave creds on disk)
```

Skip steps only with explicit user direction.

## Smoke test layers — all must stay green

| Script | Creds | Asserts |
|---|---|---|
| `scripts/smoke-test.mjs` | None | Tool inventory, annotations, output schema presence, strict-schema rejection, local trust routing |
| `scripts/smoke-test-api.mjs` | Sandbox | Real OAuth + read tools end-to-end |
| `scripts/smoke-test-writes.mjs` | Sandbox | Write tools happy + error + schema-rejection paths |

Combined target: **all green** before any commit lands on `main`.

## Secrets handling

- `.env` is gitignored. Always delete it before committing — `git status` should never show `.env` as untracked-but-about-to-be-staged.
- Never echo `WALMART_CLIENT_SECRET` or `ANTHROPIC_API_KEY` to stdout. Pass via env, read via `dotenv/config`.
- `format.ts:redactValue` strips keys matching `secret|password|token|authorization|access_key|api_key|client_secret` — relies on this for error redaction. Don't bypass.

## Documentation hierarchy

| File | Audience |
|---|---|
| `README.md` | Anyone discovering the repo |
| `docs/QUICKSTART.md` / `QUICKSTART_EN.md` | New installer (5 min path) |
| `docs/MCP_SETUP_CN.md` | Full reference for tool catalog + multi-profile + troubleshooting |
| `docs/PRODUCTION_VALIDATION.md` | Required reading before any production credential is used |
| `scripts/README.md` | Operators of the smoke/probe scripts |
| `evaluation/README.md` | mcp-builder Phase 4 evaluation suite usage |
| `CLAUDE.md` (this file) | Claude Code sessions assisting with the codebase |

When adding new features, update the relevant doc(s) **in the same PR** — the v0.2.6 install-experience PR exists precisely because tooling drifted from docs.

## Coding style

- TypeScript strict mode. No `any`; prefer `unknown` + narrowing.
- No comments explaining WHAT obvious code does. Comments only when there's a non-obvious WHY (workaround, surprising constraint, sandbox quirk).
- Imports: ES modules (`.js` extensions in TS imports — required by NodeNext resolution).
- Tests: vitest. Co-locate by area, not by code file (e.g. `tests/format.test.ts` covers everything in `helper/format.ts`).

## When in doubt

Read `scripts/probe-*.mjs` files — they document empirical discoveries about Walmart's API that the official docs don't cover.
