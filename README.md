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

## What's new in v0.5.1

- **New tool: `walmart_get_unpublished_counts`** — aggregate unpublished-item counts (broken down by reason: no shipping info, no primary image, etc.) without scanning every SKU. Verified to exist in production via `probe-prod-endpoints.mjs` (sandbox does not expose this endpoint). **Known production issue**: Walmart's aurora unpublished-item-service backend is currently returning HTTP 500. The tool ships with a fallback note in its description pointing to `walmart_get_items` + client-side aggregation, or `scripts/audit-store.mjs` which already surfaces `unpublishedReasons` per SKU.
- 22 tools total (up from 21).

## What's new in v0.5.0

**Orchestration layer — no new tools, much sharper LLM experience.** The 21 existing tools cover Walmart's full listing surface; this release polishes how an LLM uses them.

- **Tool descriptions standardized to a 3-part format** — *what it does / how to call it / known limitations or related tools*. Improves tool selection accuracy when the model is reasoning under many-tool context.
- **`scripts/audit-store.mjs`** — full-store ETL that paginates via `nextCursor` (no offset duplication), fetches per-SKU listing quality scores at configurable concurrency, and writes CSV/JSON. Solves the 815-SKU context blowup pain: the LLM only sees a summary, not the raw rows. Optional `--with-inventory` / `--with-content` enrich.
- **`scripts/probe-prod-endpoints.mjs`** — read-only probe of 10 endpoints that 404 in sandbox. Run with production credentials to discover what actually exists upstream before we ship typed tools in v0.5.1.
- **Three Claude Code skills** in `.claude/skills/` — `walmart-audit-store` (decision rule for chat vs script), `walmart-diagnose-sku` (signal→diagnosis table), `walmart-list-via-feed` (canonical feed-based write workflow, including the no-direct-reactivate-endpoint workaround).
- **Evaluation suite refreshed** — 10 questions, 6 state-independent + 4 sandbox-specific, covering composite-tool identification, strict-schema rejection, annotation correctness, and the v0.4.1 cursor pagination contract.

> **Multi-MCP roadmap**: At ~30 tools, Anthropic's mcp-builder methodology starts to degrade LLM selection accuracy. Future scope (orders / fulfillment / reports / ads) will ship as separate sibling repos rather than bloating this one. See `docs/MCP_SETUP_CN.md` for the planned split.

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

## Known production issues (as of v0.5.1)

Discovered through user dogfooding against a live production Walmart seller account. Sandbox does not reproduce these.

- **`walmart_search_my_catalog` returns 400 in production** with `"Please provide at least one Valid Query/Filters"`. The same body shape that returns 20 items in sandbox is rejected by production. Walmart sandbox-vs-production divergence on this endpoint. **Workaround:** use `walmart_get_items` (supports `lifecycleStatus` filter) for now. The tool description includes a `filter` parameter you can experiment with if you have time to iterate.
- **`walmart_get_departments` has been returning 520 SYSTEM_ERROR in production** for at least 24h as of v0.3.3 release. Walmart's `midas-data-api` backend is failing. Sandbox works fine. **Workaround:** use `walmart_get_taxonomy` — same category structure plus the full attribute schemas.
- **`walmart_get_bulk_inventory` was removed in v0.3.3** because the underlying `/v3/inventory` endpoint requires a SKU parameter (no bulk list supported by Walmart). To enumerate inventory across your catalog, iterate over `walmart_get_items` and call `walmart_get_inventory({ sku })` per SKU.
- **`walmart_get_unpublished_counts` returns HTTP 502 in production** (proxied from Walmart's aurora unpublished-item-service backend returning 500). Verified 2026-05-22 via `probe-prod-endpoints.mjs`. The endpoint path exists (otherwise it would 404) — the backend is broken upstream of the API gateway. **Workaround:** call `walmart_get_items({ publishStatus: "UNPUBLISHED" })` and aggregate `unpublishedReasons` client-side, or use `scripts/audit-store.mjs` which already surfaces this column per SKU.
- **`walmart_get_items` is cursor-paginated, not offset-paginated.** Production exhibits duplicate SKUs across offset pages when called in parallel (observed in 815-SKU store audit). v0.4.1 makes the tool description explicit: iterate sequentially using `response.nextCursor`, never fan out parallel offset calls. The `offset` input is kept for backward compat but marked deprecated.

## Tools (22 total)

**Auth / profile management (5)**
- `walmart_upsert_seller_profile`
- `walmart_list_seller_profiles`
- `walmart_set_active_seller_profile`
- `walmart_get_token_status`
- `walmart_verify_credentials`

**Items — seller catalog (5)**
- `walmart_get_items` — list your own items
- `walmart_get_item` — your seller-side metadata for a SKU (publishedStatus, wpid, etc.)
- `walmart_get_item_status` — derived status fields
- `walmart_get_complete_item` (v0.4.0) — composite: 4 parallel calls (item / inventory / per-SKU quality / Walmart catalog content) → full SKU picture in one tool call. Partial failures don't fail the call; each section reports its own `ok` flag.
- `walmart_retire_item` — delist a SKU

**Catalog — product content (2, new in v0.3.0)**
- `walmart_search_walmart_catalog` — search the Walmart public catalog by query / gtin / upc / asin. Returns title, description (HTML), images, brand, price, properties — the fields `walmart_get_item` does NOT return.
- `walmart_search_my_catalog` — filtered search of YOUR seller catalog (by lifecycle / publish / inventory status).

**Insights — listing quality (1, new in v0.3.1; per-SKU mode in v0.4.0)**
- `walmart_get_listing_quality_score` — Walmart's listing quality scores. Omit `sku`/`itemId` for store-wide aggregate (shipping/rating/offer/content/price/transactibility sub-scores). Pass `sku` or `itemId` to scope to a single SKU's breakdown.

> **Known gaps (verified empirically):** Walmart's seller catalog API does NOT expose individual SKU-level `customerRating` or `numReviews` as direct fields — you can filter `walmart_search_my_catalog` by review-status but not read the numbers. Variant group relationships (`variantGroupId`) appear in `walmart_get_item` for SKUs you own; the sandbox catalog SKUs we don't own all 404, so this needs production verification. The Buy Box report endpoint requires a separate report-request pattern that isn't a direct GET — deferred until a real need surfaces.

**Feeds (3)**
- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`

**Taxonomy (2)**
- `walmart_get_taxonomy`
- `walmart_get_departments`

**Insights — unpublished items (1, new in v0.5.1)**
- `walmart_get_unpublished_counts` — aggregate counts of unpublished items by reason. ⚠️ Walmart backend currently 500s; see Known production issues below for the fallback.

**Inventory (2)**
- `walmart_get_inventory` — per-SKU lookup (Walmart's /v3/inventory requires sku)
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

# Full-store audit ETL (sandbox or prod) — writes CSV, prints summary only
node scripts/audit-store.mjs --output store-audit.csv

# Production-only endpoint discovery (refuses to run against sandbox)
WALMART_SANDBOX=false node scripts/probe-prod-endpoints.mjs
```
