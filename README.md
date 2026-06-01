# Walmart MCP Suite

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Production-grade Model Context Protocol (MCP) servers for the **Walmart Global Marketplace API**. Multi-market by design — US, Mexico, Canada, Chile — via Walmart's `WM_MARKET` routing header.

> **Repo background**: this monorepo evolved from `walmart-listing-mcp` (v0.x — US listing only). v1.0.0 is the Walmart Global API rewrite; the same GitHub URL now hosts a workspace of one published server (`@walmart-mcp/listing-server`) and four shared libraries.

## What's inside

| Path | Purpose | Status |
|---|---|---|
| `packages/client` | `@walmart-mcp/client` — shared HTTP/auth/retry/rate-limit + `WM_MARKET` header injection | v0.1.0 |
| `packages/profiles` | `@walmart-mcp/profiles` — multi-market sellerProfile store (one profile per `market`) | v0.1.0 |
| `packages/types` | `@walmart-mcp/types` — `WalmartMarket` enum, `MARKET_CURRENCY`, `WM_GLOBAL_VERSION` | v0.1.0 |
| `packages/test-utils` | `@walmart-mcp/test-utils` — smoke-test framework helpers | v0.1.0 (skeleton) |
| `servers/listing-mcp` | `@walmart-mcp/listing-server` — **23 tools** for items / feeds / inventory / pricing / taxonomy / insights | v1.1.0 |
| `servers/orders-mcp` | Order lifecycle (acknowledge / ship / cancel / track) — 4 markets | planned (v0.6.0+) |
| `servers/fulfillment-mcp` | WFS + manual shipping (returns, lagging shipments) | planned |
| `servers/reports-mcp` | Settlement, payouts, performance metrics, tax reports | planned |
| `servers/ads-mcp` | Walmart Connect Sponsored Products (US-only initially) | planned |

## v1.0.0 — what changed from v0.5.x

**Breaking changes** (intentional — major version bump):

1. **Repo is now a monorepo**. The MCP server lives at `servers/listing-mcp/dist/index.js`, not the repo root. Update your MCP client config.
2. **`market` field is required on every sellerProfile.** Enum: `us | mx | ca | cl`. Existing v0.x profiles auto-migrate (`marketplace: "US"` → `market: "us"`).
3. **`walmart_update_price` input changed.** Was raw `payload`; now semantic `{ sku, amount, currency? }`. Currency defaults from the active market.
4. **New tool: `walmart_update_promo_price`** — promotional / clearance pricing via the new Pricing & Promotions API.
5. **`WM_MARKET` + `WM_GLOBAL_VERSION` headers** now sent on every API call (incl. OAuth token). Talks to Walmart's Global API surface.
6. **2 tools are market-restricted to US**: `walmart_get_listing_quality_score`, `walmart_get_unpublished_counts`. MX/CA/CL profiles get a structured `MARKET_NOT_SUPPORTED` error instead of a confusing Walmart 404.
7. **`marketplace` string field removed** from API responses; replaced everywhere by `market` enum.

**Why these changes**: Walmart's Mexico marketplace has a **hard cutoff of 2026-07-31** for migrating to the Global API. Canada has the same deadline. v0.x cannot meet those deadlines.

## Quickstart

```bash
git clone https://github.com/yufakang0826-hue/walmart-listing-mcp.git
cd walmart-listing-mcp
npm install
npm run build
npm test
```

Configure your MCP client (Claude Desktop, Claude Code, Codex) to spawn the listing server:

```json
{
  "mcpServers": {
    "walmart-listing": {
      "command": "node",
      "args": ["/absolute/path/to/walmart-listing-mcp/servers/listing-mcp/dist/index.js"],
      "env": {
        "WALMART_CLIENT_ID": "your-client-id",
        "WALMART_CLIENT_SECRET": "your-client-secret",
        "WALMART_MARKET": "us",
        "WALMART_SANDBOX": "true"
      }
    }
  }
}
```

> `WALMART_MARKET` is the new lowercase env var. The legacy `WALMART_MARKETPLACE=US` (uppercase) still works for backward compatibility.

For full setup including multi-market profiles, see [`servers/listing-mcp/docs/QUICKSTART.md`](./servers/listing-mcp/docs/QUICKSTART.md).

## Walmart Global API model

A single base URL serves all 4 markets. The `WM_MARKET` header routes the request:

```
Base: https://marketplace.walmartapis.com  (prod)
      https://sandbox.walmartapis.com      (sandbox — mock data, no real persistence)
Token: POST /v3/token  (includes WM_MARKET, WM_GLOBAL_VERSION: 3.1)
Items: GET  /v3/items?limit=...
Feed:  POST /v3/feeds?feedType=MP_ITEM (or MP_MAINTENANCE / PRICE_AND_PROMOTION / etc.)
Price: PUT  /v3/price?promo=false  (or ?promo=true for promotional)
...
```

**Credentials**: depending on enrollment you'll have either:
- **One Solutions Provider clientId/secret** that works across us/mx/ca/cl (one credential, four `sellerProfileId`s)
- **Per-market clientId/secret** (one credential per market, four profiles)

Both topologies are supported. Configure via `walmart_upsert_seller_profile`.

## Multi-market sellerProfile setup

```text
walmart_upsert_seller_profile({
  sellerProfileId: "walmart-us-main",
  market: "us",
  clientId: "...",
  clientSecret: "..."
})
walmart_upsert_seller_profile({
  sellerProfileId: "walmart-mx-main",
  market: "mx",
  clientId: "...",   // same as US if Solutions Provider; different if per-market enrollment
  clientSecret: "..."
})
// ...repeat for ca, cl
walmart_set_active_seller_profile({ sellerProfileId: "walmart-mx-main" })  // switch contexts
```

The active profile's `market` is sent as `WM_MARKET` on every subsequent API call. Each `(market, profile)` pair has its own OAuth token cache entry.

## Known production issues

- **`walmart_get_unpublished_counts` returns 502** (Walmart's aurora unpublished-item-service backend currently returning HTTP 500). US only. Fallback: `walmart_get_items` + client-side aggregation of `unpublishedReasons`, or `scripts/audit-store.mjs`.
- **`walmart_get_departments` returns 520 SYSTEM_ERROR** in production (Walmart midas-data-api). Sandbox fine. Workaround: `walmart_get_taxonomy` returns the same category structure plus attribute schemas.
- **`walmart_get_items` is cursor-paginated**, not offset-paginated. Production duplicates SKUs across parallel offset calls. Always iterate via `response.nextCursor` sequentially.
- **CL needs separate enrollment** for many sellers. Most Solutions Provider credentials only enroll US/MX/CA out of the box.

## Verification scripts

```bash
# No-creds structural check (tool inventory, annotations, schema)
cd servers/listing-mcp && node scripts/smoke-test.mjs

# Live sandbox reads (requires WALMART_CLIENT_ID/SECRET)
cd servers/listing-mcp && node scripts/smoke-test-api.mjs

# Sandbox writes (mock; will not affect real listings)
cd servers/listing-mcp && WALMART_SANDBOX=true node scripts/smoke-test-writes.mjs

# Identify which market a credential pair is valid for
node servers/listing-mcp/scripts/probe-which-market.mjs

# Confirm Global API multi-market routing end-to-end
node servers/listing-mcp/scripts/probe-global-multi-market.mjs

# Full-store audit ETL (writes CSV summary; LLM only sees stdout summary)
cd servers/listing-mcp && node scripts/audit-store.mjs --output store-audit.csv
```

## Security

- `.env` is gitignored. Never commit credentials.
- `WALMART_CLIENT_SECRET` is redacted from all error responses by `redactValue()`.
- Tool responses from external Walmart API are wrapped with `EXTERNAL DATA` prefix + `_source: walmart_api_untrusted` so consumers can recognize untrusted data.
- No wildcard / escape-hatch tool — every tool wraps exactly one Walmart endpoint with a typed schema.
- Walmart sandbox writes are mock (no persistence). Production writes are real money — review `docs/PRODUCTION_VALIDATION.md` before flipping `WALMART_SANDBOX=false`.

## Roadmap

- **v1.0.0** (current) — Walmart Global API + multi-market listing-mcp
- **v1.1.0** — split WalmartHttpClient base + WalmartListingClient subclass (prep for sibling MCPs)
- **v1.2.0** — `@walmart-mcp/orders-server` (4-market order lifecycle)
- **v1.3.0** — `@walmart-mcp/fulfillment-server` (WFS + manual shipping)
- **v1.4.0** — `@walmart-mcp/reports-server` (payouts / performance / tax)
- **v1.5.0** — `@walmart-mcp/ads-server` (Walmart Connect Sponsored Products)
- **v2.0.0** — MCP Resources + Prompts primitives (currently only Tools)

## Contributing

PRs welcome. Before opening:

1. `npm run build && npm run typecheck && npm test` must all pass
2. `cd servers/listing-mcp && node scripts/smoke-test.mjs` must pass
3. For new tools, follow the probe-first rule in `CLAUDE.md` — write a `scripts/probe-*.mjs` first, verify the endpoint exists, then add the typed tool

## License

Apache-2.0 — see [LICENSE](./LICENSE).
