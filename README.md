# Walmart Listing MCP

Standalone MCP server for Walmart listing workflows only.

Current scope:

- seller profile management
- credential verification
- items
- item status / retire
- feeds
- taxonomy / departments
- inventory
- price (read and write)

Not included:

- orders
- returns
- WFS
- Walmart Connect ads
- reconciliation / finance reports

## Breaking change in v0.2.0

The wildcard tool `walmart_invoke_listing_api` has been **removed**. Every operation now goes through a dedicated, typed tool. Migration:

| Old call | New tool |
|---|---|
| `walmart_invoke_listing_api({ method: "GET", path: "/v3/items?..." })` | `walmart_get_items` |
| `walmart_invoke_listing_api({ method: "DELETE", path: "/v3/items/<sku>" })` | `walmart_retire_item({ sku })` |
| `walmart_invoke_listing_api({ method: "POST", path: "/v3/feeds?feedType=..." })` | `walmart_submit_feed({ feedType, payload })` |

If you need an endpoint not covered above, open an issue or a PR adding a dedicated tool — the design choice is "no escape hatch" so the LLM cannot be tricked into hitting an unintended endpoint.

## Schema tightening in v0.2.2

The `payload` field on `walmart_submit_feed`, `walmart_update_inventory`, and `walmart_update_price` was `z.any()` in v0.2.1 and earlier, which silently allowed `undefined` / `null` / arbitrary scalar inputs. v0.2.2 tightened the schema so the field must be an object (or a string for `submit_feed` XML feeds). **If you were calling these tools with `payload: null`, `payload: "some string"` for non-feed tools, or omitting `payload` entirely, the call will now be rejected at the MCP validation layer (JSON-RPC error `-32602`) before any HTTP request goes out.** Migration: pass a proper request body object.

## Install

**5-minute quickstart**: [`docs/QUICKSTART.md`](./docs/QUICKSTART.md) (中文) · [`docs/QUICKSTART_EN.md`](./docs/QUICKSTART_EN.md) (English)

### Option 1 — Clone and build (recommended today)

```bash
git clone https://github.com/yufakang0826-hue/walmart-listing-mcp.git
cd walmart-listing-mcp
npm install && npm run build
```

Then point your MCP client (Claude Desktop / Claude Code / Codex) at `dist/index.js`. See the quickstart for the exact JSON / TOML to paste.

### Option 2 — `npx walmart-mcp-server` (after the package is published to npm)

Reserved for the next publish round. Will run without a local clone.

### Configure credentials

Two ways:

1. **MCP client `env` block** (recommended) — paste credentials into the `env` object of your `claude_desktop_config.json` / `.mcp.json` / `codex config.toml`. They never touch the repo.
2. **`.env` file at repo root** — works only if your MCP client starts the server with the repo as working directory. `.env` is already gitignored.

Example env:

```env
WALMART_CLIENT_ID=your_client_id
WALMART_CLIENT_SECRET=your_client_secret
WALMART_MARKETPLACE=US
WALMART_SANDBOX=true
```

**Default `WALMART_SANDBOX=true`** in all examples. Switch to `false` only after running [`docs/PRODUCTION_VALIDATION.md`](./docs/PRODUCTION_VALIDATION.md) — production writes are real money.

### Verify

```bash
node scripts/smoke-test.mjs       # protocol layer, no credentials needed (12 / 12 PASS)
node scripts/smoke-test-api.mjs   # live API, requires credentials (10 / 10 PASS on sandbox)
```

## MCP Integration

- **Quickstart**: [`docs/QUICKSTART.md`](./docs/QUICKSTART.md) (中文) · [`docs/QUICKSTART_EN.md`](./docs/QUICKSTART_EN.md) (English)
- **Full reference**: [`docs/MCP_SETUP_CN.md`](./docs/MCP_SETUP_CN.md) — every tool, multi-profile setup, troubleshooting
- **Before going production**: [`docs/PRODUCTION_VALIDATION.md`](./docs/PRODUCTION_VALIDATION.md)

Ready-to-edit templates (replace `<ABSOLUTE_PATH_TO_REPO>` and `<NODE_PATH>`):

- [`examples/codex-config.toml`](./examples/codex-config.toml)
- [`examples/claude-settings.json`](./examples/claude-settings.json) — works for both Claude Desktop and Claude Code

## Tools (18 total)

**Auth / profile management (5)**
- `walmart_upsert_seller_profile`
- `walmart_list_seller_profiles`
- `walmart_set_active_seller_profile`
- `walmart_get_token_status`
- `walmart_verify_credentials`

**Items (4)**
- `walmart_get_items`
- `walmart_get_item`
- `walmart_get_item_status`
- `walmart_retire_item`

**Feeds (3)**
- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`

**Taxonomy (2)**
- `walmart_get_taxonomy`
- `walmart_get_departments`

**Inventory (3)**
- `walmart_get_inventory`
- `walmart_get_bulk_inventory`
- `walmart_update_inventory`

**Price (1)**
- `walmart_update_price`

> v0.2.0 shipped `walmart_get_price` and `walmart_get_bulk_price` against `/v3/price`. Both returned 404 from Walmart's sandbox (`CONTENT_NOT_FOUND.GMP_GATEWAY_API`) — the Marketplace API does not expose a read endpoint under `/v3/price`. Both tools were removed in v0.2.1. To read current price information, call `walmart_get_item({ sku })` — the item lookup response includes price fields.

## Notes

- Seller profiles are stored locally in `.walmart-seller-profiles.json`.
- For Codex / Claude integrations, prefer putting credentials in the MCP `env` block and set `WALMART_SELLER_PROFILE_STORE` to an absolute path.
- Access tokens are cached in memory per profile or credential set.
- `walmart_get_item_status` derives publication and lifecycle fields from the item lookup response for the requested SKU.
- `walmart_get_taxonomy` defaults to `version=4.2` because Walmart sandbox returns 400 INVALID_REQUEST for `version=5.0` and `version=4.6`. Override only if Walmart support tells you to.

### Sandbox quirks to be aware of before promoting to production

Discovered empirically by `scripts/smoke-test-writes.mjs`. **None are tool bugs** — they are sandbox behavior you should plan around:

- **`get_items` returns the sandbox-global catalog, not your seller-owned items.** All SKUs returned by `get_items` will 404 on `get_item` unless you own them. Use `submit_feed` to create your own items first if you want a full happy-path workflow.
- **Write endpoints (`update_inventory`, `update_price`, `retire_item`) are mock-like in sandbox.** They return a success message for ANY SKU regardless of ownership. Production WILL return 4xx errors on unauthorized SKUs. Plan to re-verify these tools against production once with a SKU you own before relying on the error path in agent workflows.
- **`submit_feed` always returns a `feedId`,** even for clearly invalid payloads. The feed's actual fate (success / error) only shows up later via `get_feed_status`. Always poll status before assuming success.

## Security

**Credentials**
- `WALMART_CLIENT_ID` and `WALMART_CLIENT_SECRET` are required for authentication. Pass them via `.env` (local dev) or the MCP client `env` block (Codex / Claude). Never hard-code in scripts.
- Persisted seller profiles live in `.walmart-seller-profiles.json` and contain `clientSecret`. The default `.gitignore` already excludes this file — **do not check it in**.
- Access tokens are cached in memory only; they expire automatically and refresh on 401.

**Tool surface**
- No wildcard / escape-hatch tool. Every tool wraps exactly one Walmart endpoint with a typed schema, so the LLM cannot be coerced into hitting an arbitrary path or method via prompt injection.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set conservatively. MCP clients use these to decide whether to prompt the user before executing.

**Prompt injection**
- Walmart API responses (item titles, descriptions, feed messages) can contain text controlled by sellers or buyers. The server prefixes external responses with an `EXTERNAL DATA` warning and marks `structuredContent._source = "walmart_api_untrusted"` so consumers can recognize untrusted data. Do not auto-chain destructive tools based on returned content; require explicit user confirmation for any write triggered by data found in a read.

**Error & log hygiene**
- Fatal errors are logged to stderr without stack traces to avoid leaking internal paths.
- Tool error payloads pass through `redactValue` to strip keys matching `secret|password|token|authorization|access_key|api_key|client_secret`.
- The stdio transport uses stdout for the JSON-RPC stream; only stderr is safe for diagnostic output.

## Evaluation

See [`evaluation/`](./evaluation/) for the mcp-builder Phase 4 evaluation suite (10 questions, target ≥ 8 / 10 pass).

## Verification scripts

See [`scripts/README.md`](./scripts/README.md) for the full menu. Quick reference:

```bash
npm run build

# Structural tests, no credentials
node scripts/smoke-test.mjs

# Read-API tests against the live sandbox
node scripts/smoke-test-api.mjs

# Write-API tests (sandbox-only; creates feeds + calls retire)
node scripts/smoke-test-writes.mjs
```
