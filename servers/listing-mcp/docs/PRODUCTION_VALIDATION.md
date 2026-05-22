# Production Validation Runbook

One-page checklist before relying on this MCP server with a production Walmart seller account. Do this once per environment / account.

## Why this is needed

All testing through v0.2.3 ran against Walmart's sandbox, which is **mock-like** for write operations — it returns success for any SKU regardless of ownership. Sandbox cannot validate:

- Whether `update_inventory` / `update_price` / `retire_item` correctly handle 4xx errors on unauthorized SKUs in production
- Whether `walmart_get_taxonomy` default `version=4.2` works in production (sandbox required 4.2; production might want 5.0)
- Whether `walmart_get_item` returns the same shape we model in `outputSchema`
- Whether feed submission → status=PROCESSED actually produces a usable item

## Prerequisites

1. **Production Walmart credentials**: `WALMART_CLIENT_ID` + `WALMART_CLIENT_SECRET` from https://developer.walmart.com/ (different from sandbox keys).
2. **One throwaway SKU**: a real SKU in your seller account that you can:
   - Read its current price + inventory
   - Briefly write a known value to (e.g. inventory = current value, price = current price)
   - Retire IF you are willing to relist later (recommended: skip retire test the first time)
3. **Working build**: `npm install && npm run build` succeeds locally.

## The runbook (≈ 15 minutes)

### Step 1 — Configure production env

Create `.env` in the repo root (gitignored):

```env
WALMART_CLIENT_ID=<production client id>
WALMART_CLIENT_SECRET=<production client secret>
WALMART_MARKETPLACE=US
WALMART_SANDBOX=false
WALMART_CONSUMER_ID=<from developer portal>
WALMART_CHANNEL_TYPE=<from developer portal>
```

### Step 2 — Smoke test the read path

```bash
# Must succeed
node scripts/smoke-test-api.mjs
```

Expected:
- ✅ `verify_credentials` succeeds → OAuth Bearer token
- ✅ `get_taxonomy` succeeds. **If it returns 400**, the default `version=4.2` is wrong for production. Try `4.6` or `5.0` by calling `walmart_get_taxonomy({ version: "5.0" })` manually and bake the working value as the new default in `src/service/walmart-client.ts`.
- ✅ `get_items?limit=1` returns at least one SKU **that belongs to you** (production won't return foreign sellers' SKUs like sandbox does).
- ✅ `get_item({ sku: <your sku> })` returns the item record. **Note the shape** — compare against `outputSchema` in `walmart-tools.ts`. If fields are missing or named differently, update the schema.

### Step 3 — Test ONE write tool against your throwaway SKU

Pick `walmart_update_inventory` first (least destructive — same value in, same value out). Construct a payload matching Walmart's `/v3/inventory` body:

```js
// Verify against MCP Inspector or a one-off Node script
{
  sku: "<your sku>",
  payload: {
    sku: "<your sku>",
    quantity: { unit: "EACH", amount: <current value> }   // keep value same
  }
}
```

Verify:
- ✅ Returns success with a Walmart message (not just sandbox echo)
- ✅ Calling `walmart_get_inventory({ sku })` afterwards shows the value persisted

### Step 4 — Test the error path

Use a SKU you do NOT own (any random string):

```js
{ sku: "definitely-not-our-sku-zzz", payload: { sku: "definitely-not-our-sku-zzz", quantity: { unit: "EACH", amount: 5 } } }
```

Expected in production:
- ✅ `isError: true` returned
- ✅ Error message contains a status code (400 / 403 / 404) and a Walmart error code
- ❌ If it returns success like sandbox does, **production is also mocked or you have unexpected scope** — escalate to Walmart support before relying on the destructive tools

### Step 5 — Test `submit_feed` happy path

Use a real GTIN for one of your existing products to construct a minimal `MP_ITEM` feed (or skip if you don't want to create a feed entry). Verify:

- ✅ `submit_feed` returns `feedId`
- ✅ Polling `walmart_get_feed_status({ feedId })` eventually shows `feedStatus: "PROCESSED"` (may take minutes)
- ✅ After processing, the SKU appears in `walmart_get_items`

### Step 6 — Rollback / cleanup

- Restore inventory / price to original values if you changed them
- Do NOT run `walmart_retire_item` on a real SKU you want to keep
- Delete the test `.env` file or rotate the production secret if you typed it anywhere visible

## Pass criteria

You can rely on this MCP in production after:

| Check | Status |
|---|---|
| `smoke-test-api.mjs` passes against production | □ |
| `get_taxonomy` works with current default version (or you updated the default) | □ |
| `get_item` response shape matches `outputSchema` (or you updated the schema) | □ |
| `update_inventory` happy path persists | □ |
| `update_inventory` error path returns actionable 4xx | □ |
| `submit_feed` round-trip processes successfully | □ |
| Production secret never appeared in chat / screenshots / commit history | □ |

## If anything fails

- Open an issue with the failing test name + full response text (redact your secret first!)
- Roll back to v0.2.3 and use sandbox only until fix lands
- The 4 tools with `destructiveHint: true` will still prompt the MCP client (Claude Desktop / Codex) for user confirmation before each call, so even with bugs the blast radius is limited per-tool

## Time estimate

~15–30 minutes if everything passes. ~1–2 hours if `get_item` outputSchema or `get_taxonomy` version need adjustment + a new release.
