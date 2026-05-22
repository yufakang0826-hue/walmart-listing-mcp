// Probe Walmart endpoints that 404'd in sandbox, to determine whether they
// exist in production. Run THIS against your production credentials to
// validate which endpoints to ship as MCP tools in v0.5.1+.
//
// Usage:
//   1. Configure .env with PRODUCTION credentials and WALMART_SANDBOX=false
//   2. npm run build
//   3. node scripts/probe-prod-endpoints.mjs
//
// The script does NOT write anything to Walmart. All probes are GET requests
// (or POST/PUT against deliberately-invalid bodies that should fail validation
// before any persistence). Safe to run against production.

import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";

if (process.env.WALMART_SANDBOX === "true") {
  console.error(
    "This script is intended for production verification. Set WALMART_SANDBOX=false " +
    "in your .env to run against production. Aborting to prevent re-discovering sandbox 404s.",
  );
  process.exit(1);
}

console.log("Probing PRODUCTION endpoints. No data will be created or modified.\n");

const client = authService.createClient();

async function probe(label, req) {
  try {
    const r = await client.request(req);
    const summary = Array.isArray(r)
      ? `Array(${r.length})`
      : r && typeof r === "object"
        ? `keys=${Object.keys(r).slice(0, 12).join(",")}`
        : String(r).slice(0, 80);
    console.log(`OK   ${label}\n     ${summary}\n`);
    return { ok: true, summary };
  } catch (err) {
    const status = err?.statusCode ?? "?";
    const detail = err?.details
      ? JSON.stringify(err.details).slice(0, 220)
      : String(err.message).slice(0, 220);
    console.log(`${status}  ${label}\n     ${detail}\n`);
    return { ok: false, status, detail };
  }
}

const findings = [];

console.log("##### Candidate: walmart_get_item_spec — GET /v3/items/specs #####");
findings.push([
  "get_item_spec",
  await probe("specs no params", { method: "GET", path: "/v3/items/specs" }),
]);
findings.push([
  "get_item_spec_typed",
  await probe("specs feedType=MP_ITEM v=4.2", {
    method: "GET",
    path: "/v3/items/specs",
    params: { feedType: "MP_ITEM", version: "4.2" },
  }),
]);

console.log("##### Candidate: walmart_get_unpublished_items #####");
findings.push([
  "get_unpublished_items_list",
  await probe("/insights/items/unpublished", {
    method: "GET",
    path: "/v3/insights/items/unpublished",
  }),
]);
findings.push([
  "get_unpublished_items_counts",
  await probe("/insights/items/unpublished/counts", {
    method: "GET",
    path: "/v3/insights/items/unpublished/counts",
  }),
]);

console.log("##### Candidate: walmart_get_variants — GET /v3/items/{itemId}/variants #####");
console.log("(Replace 5212572 with a real itemId from your account; sandbox SKU likely 404s)\n");
findings.push([
  "get_variants",
  await probe("variants 5212572", { method: "GET", path: "/v3/items/5212572/variants" }),
]);

console.log("##### Candidate: walmart_get_listing_quality_by_category #####");
findings.push([
  "lq_categories",
  await probe("LQ categories", {
    method: "GET",
    path: "/v3/insights/listingQuality/categories",
  }),
]);

console.log("##### Candidate: walmart_create_item — POST /v3/items (will fail validation, that is the point) #####");
findings.push([
  "create_item",
  await probe("POST /v3/items empty body (expect 400, NOT 404 if endpoint exists)", {
    method: "POST",
    path: "/v3/items",
    body: {},
  }),
]);

console.log("##### Candidate: walmart_update_item — PUT /v3/items/{sku} #####");
findings.push([
  "update_item",
  await probe("PUT /v3/items/probe-test empty (expect 400/404 — 400 if endpoint exists)", {
    method: "PUT",
    path: "/v3/items/probe-test",
    body: {},
  }),
]);

console.log("##### Candidate: walmart_get_promo_pricing — GET /v3/price/promo #####");
findings.push([
  "promo_get",
  await probe("GET /v3/price/promo", { method: "GET", path: "/v3/price/promo" }),
]);
findings.push([
  "promo_get_with_sku",
  await probe("GET /v3/price/promo?sku=probe", {
    method: "GET",
    path: "/v3/price/promo",
    params: { sku: "probe-test" },
  }),
]);

console.log("##### Candidate: walmart_get_multi_fc_inventory #####");
findings.push([
  "multi_fc_get",
  await probe("/v3/inventories/probe-test", {
    method: "GET",
    path: "/v3/inventories/probe-test",
  }),
]);

console.log("\n##### SUMMARY — endpoints that exist in production (200 or non-404 error) #####\n");
const exists = findings.filter(([, r]) => r.ok || (r.status && r.status !== 404));
const missing = findings.filter(([, r]) => r.status === 404);
console.log(`Likely exists (${exists.length}):`);
for (const [name, r] of exists) {
  console.log(`  - ${name} → ${r.ok ? "200 " + r.summary : r.status + " " + r.detail.slice(0, 80)}`);
}
console.log(`\n404 (does not exist OR sandbox-only path) (${missing.length}):`);
for (const [name] of missing) {
  console.log(`  - ${name}`);
}

console.log("\nNext step: for each 'Likely exists' entry, paste this output back so we can ship typed tools in v0.5.1.");
