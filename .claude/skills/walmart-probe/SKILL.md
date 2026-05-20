---
name: walmart-probe
description: Discover the correct shape of a Walmart Marketplace API endpoint by probing the sandbox with multiple candidate variants. Use when adding a new tool or debugging an existing one that returns 4xx/5xx with unclear errors.
disable-model-invocation: true
---

# walmart-probe

Walmart's API docs are sparse and frequently wrong. This skill codifies the empirical pattern we've used to discover working endpoint shapes (see `scripts/probe-*.mjs` for past examples — taxonomy version, search_my_catalog body, gaps for variants/reviews).

## When to use

- New Walmart endpoint, response shape unknown
- Existing tool returns 400/405 with cryptic Walmart error codes
- Suspect a sandbox-vs-production difference

## Process

1. **Identify the endpoint + ≥ 5 candidate variants.** Variants = different bodies, methods, paths, query-param shapes, or response formats. Walmart's error messages often hint at the wrong field name — extract those hints into the next round of variants.

2. **Author `scripts/probe-<name>.mjs`** using this template:

```js
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") {
  console.error("sandbox-only");
  process.exit(1);
}

const client = authService.createClient();

const variants = [
  ["label A", { method: "GET", path: "...", params: {...} }],
  ["label B", { method: "POST", path: "...", body: {...} }],
  // ... ≥ 5 variants
];

for (const [label, req] of variants) {
  try {
    const r = await client.request(req);
    console.log(`OK   ${label}\n     keys=${Object.keys(r || {}).slice(0, 8).join(",")}`);
  } catch (err) {
    const d = err?.details ? JSON.stringify(err.details).slice(0, 200) : String(err.message).slice(0, 200);
    console.log(`ERR  ${label}\n     ${d}`);
  }
}
```

Why bypass the MCP serialization layer (call `authService.createClient()` directly)? Because the redactor strips the access token, preventing direct fetch debugging through the tool layer.

3. **Build + run**: `npm run build && node scripts/probe-<name>.mjs`. Sandbox creds must be in `.env`. Read errors carefully — Walmart's response often names the failing field which informs the next variant.

4. **Iterate** until ≥ 1 variant returns 200 with usable data. Document the working shape in the script's comments.

5. **Codify in `src/service/walmart-client.ts`** as a typed method; surface as a tool in `walmart-tools.ts` with input/output schemas matching what sandbox returned.

6. **Commit the probe script** alongside the client/tool changes. Future probes start from your code, not from Walmart's docs.

## Anti-patterns

- ❌ Reading Walmart docs and assuming the documented shape is correct (docs are stale)
- ❌ Trying one variant, getting 400, removing the tool (try ≥ 5 before giving up)
- ❌ Hard-coding the working shape without leaving the probe script — next person can't reproduce the discovery

## Production divergence flag

If the working sandbox shape ships and a user later reports a different error in production, **the endpoint has a sandbox-vs-prod divergence**. Document in README "Known production issues" — don't keep guessing variants without prod access.

## Past discoveries

| Endpoint | Probe script | Outcome |
|---|---|---|
| `walmart_get_taxonomy` default version | `probe-taxonomy.mjs` | Discovered `version=4.2` works, 5.0/4.6 return 400 |
| `walmart_search_my_catalog` body shape | `probe-my-catalog.mjs` | Walked 14 variants to land on `{query: {field, values}, sort?}` |
| Per-SKU listing quality | `probe-gaps.mjs` | Discovered existing endpoint accepts `sku`/`itemId` params |
| Variants / reviews / content endpoints | `probe-gaps.mjs` | Confirmed Walmart-side gaps (all 404) |
