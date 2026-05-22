// Probe walmart_search_walmart_catalog for the full `properties` content +
// SPEC response format to see what product attributes are actually accessible.
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") process.exit(1);

const client = authService.createClient();

async function dump(label, params) {
  console.log(`\n=== ${label} ===`);
  console.log("params:", JSON.stringify(params));
  try {
    const r = await client.searchWalmartCatalog(params);
    if (Array.isArray(r)) {
      console.log("array.length:", r.length);
      return;
    }
    if (r && typeof r === "object") {
      // Print top-level keys
      console.log("top-level keys:", Object.keys(r).join(","));
      // If properties exists, dump it fully
      if (r.properties) {
        console.log("\nproperties full dump:");
        console.log(JSON.stringify(r.properties, null, 2));
      }
      // If SPEC, the response shape is different
      if (r.spec || r.attributes) {
        console.log("\nspec / attributes dump (first 800 chars):");
        console.log(JSON.stringify(r.spec || r.attributes, null, 2).slice(0, 800));
      }
    }
  } catch (err) {
    console.log("ERR:", String(err.message || err).slice(0, 200));
  }
}

try {
  await dump("DEFAULT format — Touch Up paint", { gtin: "00193514013203" });
  await dump("SPEC format — Touch Up paint", { gtin: "00193514013203", responseFormat: "SPEC" });
} catch (err) {
  console.error(err);
}
