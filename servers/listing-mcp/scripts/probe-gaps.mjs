// Probe candidate endpoints to close the remaining gaps:
//   - per-SKU listing quality (vs aggregate)
//   - full item content (vs metadata only)
//   - variant relationships
//   - review numbers as readable values
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") process.exit(1);

const client = authService.createClient();

const probes = [
  // Per-SKU listing quality variants
  ["per-SKU quality A", { method: "GET", path: "/v3/insights/items/listingQuality/score/5212572" }],
  ["per-SKU quality B", { method: "GET", path: "/v3/insights/items/listingQuality/score", params: { sku: "5212572" } }],
  ["per-SKU quality C", { method: "GET", path: "/v3/insights/items/listingQuality/score", params: { itemId: "5212572" } }],

  // Full item content (vs the metadata-only /v3/items/{sku})
  ["item content via /content", { method: "GET", path: "/v3/items/5212572/content" }],
  ["item content via /attributes", { method: "GET", path: "/v3/items/5212572/attributes" }],
  ["item content via /details", { method: "GET", path: "/v3/items/5212572/details" }],
  ["item with embed param", { method: "GET", path: "/v3/items/5212572", params: { embed: "content" } }],

  // Variant relationships
  ["variants endpoint", { method: "GET", path: "/v3/items/5212572/variants" }],
  ["variant-group endpoint", { method: "GET", path: "/v3/items/variants/5212572" }],
  ["items with includeVariants", { method: "GET", path: "/v3/items/5212572", params: { includeVariants: "true" } }],

  // Reviews
  ["reviews per-SKU", { method: "GET", path: "/v3/reviews/items/5212572" }],
  ["reviews summary", { method: "GET", path: "/v3/insights/items/reviews/5212572" }],
];

for (const [label, req] of probes) {
  try {
    const r = await client.request(req);
    const summary = Array.isArray(r)
      ? `Array(${r.length})`
      : r && typeof r === "object"
        ? `keys=${Object.keys(r).slice(0, 8).join(",")}`
        : String(r).slice(0, 80);
    console.log(`OK   ${label}\n     ${summary}`);
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : "?";
    const d = err && err.details ? JSON.stringify(err.details).slice(0, 120) : String(err.message).slice(0, 120);
    console.log(`${status}  ${label}\n     ${d}`);
  }
}
