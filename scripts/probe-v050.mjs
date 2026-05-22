// Probe the 7 candidate new endpoints for v0.5.0 listing-comprehensive scope.
// Per CLAUDE.md probe-first pattern.
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") process.exit(1);

const client = authService.createClient();

async function probe(label, req) {
  try {
    const r = await client.request(req);
    const summary = Array.isArray(r)
      ? `Array(${r.length})`
      : r && typeof r === "object"
        ? `keys=${Object.keys(r).slice(0, 8).join(",")}`
        : String(r).slice(0, 80);
    console.log(`OK   ${label}\n     ${summary}`);
  } catch (err) {
    const status = err?.statusCode ?? "?";
    const d = err?.details ? JSON.stringify(err.details).slice(0, 200) : String(err.message).slice(0, 200);
    console.log(`${status}  ${label}\n     ${d}`);
  }
}

console.log("\n##### get_item_spec — GET /v3/items/specs #####");
await probe("specs no params", { method: "GET", path: "/v3/items/specs" });
await probe("specs productType=MP_ITEM", { method: "GET", path: "/v3/items/specs", params: { productType: "MP_ITEM" } });
await probe("specs productType=NavSecondaryDressShoes", { method: "GET", path: "/v3/items/specs", params: { productType: "NavSecondaryDressShoes" } });
await probe("specs feedType=MP_ITEM v=4.2", { method: "GET", path: "/v3/items/specs", params: { feedType: "MP_ITEM", version: "4.2" } });

console.log("\n##### get_unpublished_items #####");
await probe("/insights/items/unpublished", { method: "GET", path: "/v3/insights/items/unpublished" });
await probe("/insights/items/unpublished?limit=5", { method: "GET", path: "/v3/insights/items/unpublished", params: { limit: 5 } });
await probe("/insights/items/unpublished/counts", { method: "GET", path: "/v3/insights/items/unpublished/counts" });

console.log("\n##### get_variants — GET /v3/items/{id}/variants #####");
// Use a sandbox SKU we know exists (5212572 from get_items)
await probe("variants for 5212572", { method: "GET", path: "/v3/items/5212572/variants" });

console.log("\n##### listing_quality by category — GET /v3/insights/listingQuality/categories #####");
await probe("LQ categories", { method: "GET", path: "/v3/insights/listingQuality/categories" });

console.log("\n##### create_item — POST /v3/items (validation only, expect 400) #####");
await probe("POST /v3/items empty body", { method: "POST", path: "/v3/items", body: {} });
await probe("POST /v3/items minimal MPItem", {
  method: "POST",
  path: "/v3/items",
  body: { MPItem: [{ Item: { sku: "probe-test-" + Date.now(), productName: "probe" } }] },
});

console.log("\n##### update_item — PUT /v3/items/{sku} #####");
await probe("PUT /v3/items/probe-test empty", { method: "PUT", path: "/v3/items/probe-test", body: {} });
