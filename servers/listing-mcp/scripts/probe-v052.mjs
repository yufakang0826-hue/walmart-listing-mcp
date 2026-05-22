// v0.5.2 corrected production probe.
//
// v0.5.1 probe (probe-prod-endpoints.mjs) got 404 on most candidates because
// I guessed the wrong paths. Walmart docs research (see release notes for
// v0.5.2 background) revealed the correct paths — most notably that all
// /v3/insights/* endpoints have an `items/` segment I dropped.
//
// This probe uses the CORRECTED paths to verify what actually returns 200.
// Run against production (WALMART_SANDBOX=false). All requests are GET or
// POST with minimal-valid bodies, no destructive operations.

import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";

if (process.env.WALMART_SANDBOX === "true") {
  console.error("Set WALMART_SANDBOX=false. Aborting.");
  process.exit(1);
}

const client = authService.createClient();
console.log("Probing PRODUCTION with corrected paths. Read-only / non-destructive.\n");

async function probe(label, req) {
  try {
    const r = await client.request(req);
    const summary = Array.isArray(r)
      ? `Array(${r.length})`
      : r && typeof r === "object"
        ? `keys=${Object.keys(r).slice(0, 12).join(",")}`
        : String(r).slice(0, 80);
    console.log(`OK   ${label}\n     ${summary}\n`);
    return { ok: true, label, summary };
  } catch (err) {
    const status = err?.statusCode ?? "?";
    const detail = err?.details
      ? JSON.stringify(err.details).slice(0, 240)
      : String(err.message).slice(0, 240);
    console.log(`${status}  ${label}\n     ${detail}\n`);
    return { ok: false, label, status, detail };
  }
}

const findings = [];

// --- 1. Item Spec (POST, not GET; spec singular, not specs) -------------------
console.log("##### Item Spec — POST /v3/items/spec #####");
findings.push(await probe("POST /v3/items/spec with productTypes=[]", {
  method: "POST",
  path: "/v3/items/spec",
  body: { feedType: "MP_ITEM", version: "4.2", productTypes: [] },
}));
findings.push(await probe("POST /v3/items/spec with one productType", {
  method: "POST",
  path: "/v3/items/spec",
  body: { feedType: "MP_ITEM", version: "4.2", productTypes: ["Phone Cases"] },
}));

// --- 2. Unpublished Items LIST (was missing 'items/' segment + needs fromDate)
console.log("##### Insights — unpublished items list #####");
const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
findings.push(await probe(`GET /v3/insights/items/unpublished/items?fromDate=${lastWeek}`, {
  method: "GET",
  path: "/v3/insights/items/unpublished/items",
  params: { fromDate: lastWeek },
}));
// Re-check counts at corrected path (singular 'count')
findings.push(await probe("GET /v3/insights/items/unpublished/count (singular)", {
  method: "GET",
  path: "/v3/insights/items/unpublished/count",
}));

// --- 3. Listing Quality (corrected: items/ segment + count not categories) ----
console.log("##### Insights — listing quality by category #####");
findings.push(await probe("GET /v3/insights/items/listingQuality/count?type=category", {
  method: "GET",
  path: "/v3/insights/items/listingQuality/count",
  params: { type: "category" },
}));
findings.push(await probe("GET /v3/insights/items/listingQuality/count?type=brand", {
  method: "GET",
  path: "/v3/insights/items/listingQuality/count",
  params: { type: "brand" },
}));
findings.push(await probe("GET /v3/insights/items/listingQuality/score (catalog-wide)", {
  method: "GET",
  path: "/v3/insights/items/listingQuality/score",
}));

// --- 4. Multi-FC Inventory (corrected: path was probably right, re-probe) -----
console.log("##### Multi-FC inventory #####");
findings.push(await probe("GET /v3/inventories (list)", {
  method: "GET",
  path: "/v3/inventories",
}));

// Print summary
console.log("\n##### SUMMARY #####\n");
const exists = findings.filter((r) => r.ok || (r.status && r.status !== 404));
const missing = findings.filter((r) => r.status === 404);
console.log(`Exists / non-404 (${exists.length}):`);
for (const r of exists) {
  console.log(`  - ${r.label}\n    ${r.ok ? "200 " + r.summary : r.status + " " + r.detail.slice(0, 120)}`);
}
console.log(`\nReal 404 (${missing.length}):`);
for (const r of missing) console.log(`  - ${r.label}`);
