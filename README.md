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
- price
- direct listing API invocation for listing-related endpoints only

Not included in this version:

- orders
- returns
- WFS
- Walmart Connect ads
- reconciliation / finance reports

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

## Main Tools

- `walmart_upsert_seller_profile`
- `walmart_list_seller_profiles`
- `walmart_set_active_seller_profile`
- `walmart_get_token_status`
- `walmart_verify_credentials`
- `walmart_invoke_listing_api`
- `walmart_get_items`
- `walmart_get_item`
- `walmart_get_item_status`
- `walmart_retire_item`
- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`
- `walmart_get_taxonomy`
- `walmart_get_departments`
- `walmart_get_inventory`
- `walmart_get_bulk_inventory`
- `walmart_update_inventory`
- `walmart_update_price`

## Notes

- Seller profiles are stored locally in `.walmart-seller-profiles.json`.
- For Codex / Claude integrations, prefer putting credentials in the MCP `env` block and set `WALMART_SELLER_PROFILE_STORE` to an absolute path.
- `walmart_invoke_listing_api` is restricted to:
  - `/v3/items`
  - `/v3/inventory`
  - `/v3/price`
  - `/v3/feeds`
  - `/v3/utilities/taxonomy`
- Access tokens are cached in memory per profile or credential set.
- `walmart_get_item_status` derives publication and lifecycle fields from the item lookup response for the requested SKU.

## Security

**Credentials**
- `WALMART_CLIENT_ID` and `WALMART_CLIENT_SECRET` are required for authentication. Pass them via `.env` (local dev) or the MCP client `env` block (Codex / Claude). Never hard-code in scripts.
- Persisted seller profiles live in `.walmart-seller-profiles.json` and contain `clientSecret`. The default `.gitignore` already excludes this file — **do not check it in**.
- Access tokens are cached in memory only; they expire automatically and refresh on 401.

**Tool surface**
- `walmart_invoke_listing_api` accepts an arbitrary HTTP method and path. The path is validated against an allow-list (see Notes) and rejects `..` / `%2e` / `\\` / `%5c` traversal sequences. Still, treat this tool as **destructive and non-idempotent** — agents should confirm with the user before invoking with `DELETE` / `PUT` / `POST`.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set conservatively. MCP clients use these to decide whether to prompt the user before executing.

**Prompt injection**
- Walmart API responses (item titles, descriptions, feed messages) can contain text controlled by sellers or buyers. When the agent surfaces this text it is **untrusted input to the LLM**. Do not auto-chain destructive tools based on returned content; require explicit user confirmation for any write triggered by data found in a read.

**Error & log hygiene**
- Fatal errors are logged to stderr without stack traces to avoid leaking internal paths.
- Tool error payloads pass through `redactValue` to strip keys matching `secret|password|token|authorization|access_key|api_key|client_secret`.
- The stdio transport uses stdout for the JSON-RPC stream; only stderr is safe for diagnostic output.
