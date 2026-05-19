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

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure credentials with either:

- `.env`
- or MCP tools such as `walmart_upsert_seller_profile`

Example `.env`:

```env
WALMART_CLIENT_ID=your_client_id
WALMART_CLIENT_SECRET=your_client_secret
WALMART_MARKETPLACE=US
WALMART_SANDBOX=false
```

3. Build and run:

```bash
npm run build
npm start
```

## MCP Integration

Complete Codex / Claude integration instructions:

- [docs/MCP_SETUP_CN.md](./docs/MCP_SETUP_CN.md)

Ready-to-edit examples:

- [examples/codex-config.toml](./examples/codex-config.toml)
- [examples/claude-settings.json](./examples/claude-settings.json)

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
