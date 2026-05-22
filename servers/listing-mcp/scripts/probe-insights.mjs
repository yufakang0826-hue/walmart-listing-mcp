// Probe Insights / Buy Box / variant / review endpoints to see what sandbox returns.
import { connectMcp, requireSandbox } from "./_helpers.mjs";
requireSandbox("queries insights / buybox / catalog");

const { client, close } = await connectMcp("probe-insights");

async function probe(label, name, args) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await client.callTool({ name, arguments: args });
    console.log("isError:", r.isError);
    if (r.isError) {
      console.log("error:", (r.content?.[0]?.text || "").slice(0, 280));
    } else {
      const sc = r.structuredContent;
      console.log("keys:", Object.keys(sc || {}));
      if (sc && typeof sc === "object") {
        for (const [k, v] of Object.entries(sc).slice(0, 8)) {
          if (Array.isArray(v)) console.log(`  ${k}: Array(${v.length})${v[0] ? ", item keys=" + Object.keys(v[0] || {}).slice(0, 8).join(",") : ""}`);
          else if (typeof v === "object" && v !== null) console.log(`  ${k}: Object{${Object.keys(v).slice(0, 8).join(",")}}`);
          else console.log(`  ${k}:`, String(v).slice(0, 80));
        }
      }
    }
  } catch (err) {
    console.log("THROWN:", String(err).slice(0, 280));
  }
}

try {
  await probe("listing_quality_score", "walmart_get_listing_quality_score", {});
  await probe("listing_quality_score viewTrending", "walmart_get_listing_quality_score", { viewTrendingItems: true });
  await probe("unpublished_items", "walmart_get_unpublished_items", { limit: 5 });
  await probe("buybox_report", "walmart_get_buybox_report", {});
  // Look for variant / review fields in catalog search
  await probe("catalog gtin lookup — full keys", "walmart_search_walmart_catalog", { gtin: "00193514013203" });
  // Try get_item on a known sandbox SKU to see variantGroupId field
  await probe("get_item 5212572 (sandbox catalog SKU)", "walmart_get_item", { sku: "5212572" });
} finally {
  await close();
}
