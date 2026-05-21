// Probe Walmart /v3/items pagination to confirm cursor vs offset behavior.
// Per CLAUDE.md probe-first pattern.
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") process.exit(1);

const client = authService.createClient();

function summarize(label, r) {
  const items = r?.ItemResponse || [];
  const skus = items.map((i) => i.sku).filter(Boolean);
  console.log(`\n=== ${label} ===`);
  console.log(`  count=${items.length}  totalItems=${r?.totalItems}  nextCursor=${r?.nextCursor ?? "(none)"}`);
  console.log(`  skus: ${skus.slice(0, 5).join(",")}${skus.length > 5 ? "..." : ""}`);
}

const p1 = await client.getItems({ limit: 5 });
summarize("page 1 limit=5", p1);

if (p1?.nextCursor) {
  try {
    const p2 = await client.getItems({ limit: 5, cursor: p1.nextCursor });
    summarize("page 2 via cursor=...", p2);
    const p1Skus = new Set((p1.ItemResponse || []).map((i) => i.sku));
    const p2Skus = (p2?.ItemResponse || []).map((i) => i.sku);
    const overlap = p2Skus.filter((s) => p1Skus.has(s));
    console.log(`\n  cursor pagination overlap (p2 ∩ p1): ${overlap.length} ${overlap.length === 0 ? "CLEAN" : "DUP"}`);
  } catch (err) {
    console.log(`  cursor query failed: ${err.message || String(err)}`);
  }
}

try {
  const p2off = await client.getItems({ limit: 5, offset: 5 });
  summarize("page 2 via offset=5", p2off);
  const p1Skus = new Set((p1?.ItemResponse || []).map((i) => i.sku));
  const p2offSkus = (p2off?.ItemResponse || []).map((i) => i.sku);
  const overlap = p2offSkus.filter((s) => p1Skus.has(s));
  console.log(`\n  offset pagination overlap (p2 ∩ p1): ${overlap.length} ${overlap.length === 0 ? "CLEAN" : "DUP — production bug confirmed"}`);
} catch (err) {
  console.log(`  offset query failed: ${err.message || String(err)}`);
}

const cursor = p1?.nextCursor;
if (cursor) {
  for (const paramName of ["nextCursor", "page_cursor", "after"]) {
    try {
      const r = await client.getItems({ limit: 5, [paramName]: cursor });
      const skus = (r?.ItemResponse || []).map((i) => i.sku);
      const p1Skus = new Set((p1?.ItemResponse || []).map((i) => i.sku));
      const overlap = skus.filter((s) => p1Skus.has(s));
      console.log(`  ?${paramName}=...: count=${skus.length}, overlap with p1 = ${overlap.length}`);
    } catch (err) {
      console.log(`  ?${paramName}=... failed: ${err.message || String(err)}`);
    }
  }
}
