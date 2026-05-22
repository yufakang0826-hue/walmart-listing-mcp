# scripts/

Operational tools that run against a built server (`npm run build` first). Each script spawns `node dist/index.js` over stdio and exercises specific behaviors.

| Script | Purpose | Needs credentials? | Sandbox-only guard? |
|---|---|---|---|
| `smoke-test.mjs` | Structural regression: tool inventory, annotations, strict schema, structuredContent shape, local trust routing | No | No (safe everywhere) |
| `smoke-test-api.mjs` | Read-API regression against the live Walmart API: OAuth, taxonomy, departments, items, profile round-trip | Yes (any) | No |
| `smoke-test-writes.mjs` | Write-API regression: submit_feed (JSON + XML), update_inventory, update_price, retire_item — happy + schema-rejection + API-rejection paths | Yes (sandbox) | **Yes** — refuses to run without `WALMART_SANDBOX=true` |
| `probe-skus.mjs` | Diagnostic: enumerate `get_items` and try `get_item` for each. Documents the sandbox catalog/ownership mismatch | Yes (sandbox) | **Yes** |
| `inspect-writes.mjs` | Diagnostic: print full structured responses for each write tool so you can audit what sandbox actually returned | Yes (sandbox) | **Yes** |

## Run

Build first:

```bash
npm install && npm run build
```

Configure `.env` (sandbox example — never commit):

```env
WALMART_CLIENT_ID=<your sandbox client id>
WALMART_CLIENT_SECRET=<your sandbox client secret>
WALMART_MARKETPLACE=US
WALMART_SANDBOX=true
```

Then run any script with plain `node`:

```bash
# No credentials needed — verify protocol layer
node scripts/smoke-test.mjs

# Read-API verification (12 assertions)
node scripts/smoke-test-api.mjs

# Write-API verification (16 assertions). REFUSES to run unless WALMART_SANDBOX=true.
node scripts/smoke-test-writes.mjs

# Diagnostic — find which SKUs in get_items resolve via get_item
node scripts/probe-skus.mjs

# Diagnostic — see raw write responses
node scripts/inspect-writes.mjs
```

## Why sandbox-only guards?

`smoke-test-writes.mjs`, `inspect-writes.mjs`, and `probe-skus.mjs` either submit feeds, attempt updates, or query SKUs that aren't necessarily yours. In production those would be real mutations or visible-to-others reads. The guard checks `process.env.WALMART_SANDBOX === "true"` (loaded via `dotenv/config`) and refuses to start otherwise. Override only by editing the `.env`, never by patching the guard out.

## Cleanup considerations

`smoke-test-writes.mjs` creates 2 unique feed submissions per run (`smoke-${timestamp}` JSON + `smoke-xml-${timestamp}` XML) and one retire_item call. Walmart sandbox does not expose feed deletion — these accumulate in your sandbox feed history. Acceptable for occasional dev verification; not appropriate as a CI step running on every commit without manual oversight.
