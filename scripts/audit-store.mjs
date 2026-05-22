#!/usr/bin/env node
// Full-store listing audit ETL.
//
// Why this exists: doing a 100+ SKU audit through an interactive LLM
// conversation blows the context budget. The LLM is not an ETL engine.
// This script does the bulk iteration and writes results to a file; the
// LLM only sees a summary.
//
// What it does:
//   1. Paginate walmart_get_items via nextCursor (sequential, dedupes by sku)
//   2. For each SKU, call walmart_get_listing_quality_score({sku}) for per-SKU
//      content/offer/rating sub-scores
//   3. Optionally call walmart_get_inventory({sku}) and/or
//      walmart_search_walmart_catalog({gtin}) for richer audit (slower)
//   4. Write everything to CSV (default) or JSON
//   5. Print a short summary to stdout (LLM sees this)
//
// Usage:
//   node scripts/audit-store.mjs --output store-audit.csv
//   node scripts/audit-store.mjs --output store-audit.json --format json
//   node scripts/audit-store.mjs --output audit.csv --with-inventory --with-content
//   node scripts/audit-store.mjs --limit 50          # cap pages for testing
//   node scripts/audit-store.mjs --concurrency 5     # per-SKU quality probe parallelism
//
// Required: .env with WALMART_CLIENT_ID / WALMART_CLIENT_SECRET (sandbox or prod).
// Safe: only READ operations.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { authService } from "../dist/service/auth-service.js";

// ---------- CLI parsing ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = arr[i + 1];
      acc.push([k, next && !next.startsWith("--") ? next : "true"]);
    }
    return acc;
  }, []),
);
const outputPath = args.output || `store-audit-${new Date().toISOString().slice(0, 10)}.csv`;
const format = (args.format || (outputPath.endsWith(".json") ? "json" : "csv")).toLowerCase();
const limitPages = args.limit ? parseInt(args.limit, 10) : Infinity;
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
const withInventory = args["with-inventory"] === "true";
const withContent = args["with-content"] === "true";

console.error(`[audit] output=${outputPath} format=${format} concurrency=${concurrency} pages-cap=${limitPages}`);
console.error(`[audit] enrichments: inventory=${withInventory} content=${withContent}\n`);

// ---------- Helpers ----------
const client = authService.createClient();

async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { _error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function flat(o) {
  // Flatten nested score objects so they become discoverable columns.
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        out[`${k}.${k2}`] = typeof v2 === "object" ? JSON.stringify(v2) : v2;
      }
    } else if (Array.isArray(v)) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toCSV(rows) {
  if (rows.length === 0) return "";
  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set()));
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
  return header + "\n" + body + "\n";
}

// ---------- Phase 1: paginate items, dedupe ----------
console.error("[phase 1] paginating walmart_get_items via nextCursor...");
const byId = new Map(); // sku -> item
let cursor;
let pageNum = 0;
let totalSeen = 0;

while (pageNum < limitPages) {
  pageNum++;
  const params = cursor ? { nextCursor: cursor } : {};
  let page;
  try {
    page = await client.getItems(params);
  } catch (err) {
    console.error(`[phase 1] page ${pageNum} failed: ${err instanceof Error ? err.message : String(err)}`);
    break;
  }
  const items = page?.ItemResponse || [];
  totalSeen += items.length;
  let newCount = 0;
  for (const it of items) {
    const key = it?.sku || it?.wpid || it?.itemId;
    if (!key) continue;
    if (!byId.has(key)) {
      byId.set(key, it);
      newCount++;
    }
  }
  const nextCursor = page?.nextCursor;
  console.error(`[phase 1] page ${pageNum}: got ${items.length} items (${newCount} new); unique so far: ${byId.size}; nextCursor=${nextCursor ? "yes" : "(end)"}`);
  if (!nextCursor || nextCursor === cursor) break;
  cursor = nextCursor;
  // Gentle pacing
  await new Promise((r) => setTimeout(r, 100));
}

const skus = Array.from(byId.keys());
console.error(`\n[phase 1 done] total responses=${totalSeen}, unique SKUs=${skus.length}, duplicates dropped=${totalSeen - skus.length}`);

if (skus.length === 0) {
  console.log("0 SKUs found. No output written.");
  process.exit(0);
}

// ---------- Phase 2: per-SKU enrichment ----------
console.error(`\n[phase 2] fetching per-SKU listing quality (concurrency=${concurrency})...`);

const enriched = await pMapLimit(skus, concurrency, async (sku, i) => {
  const base = byId.get(sku);
  const result = { sku, ...flat(base) };

  try {
    const q = await client.getListingQualityScore({ sku: String(sku) });
    const payload = q?.payload || {};
    result["quality.overall"] = payload.overAllQuality;
    if (payload.score && typeof payload.score === "object") {
      for (const [k, v] of Object.entries(payload.score)) result[`quality.${k}`] = v;
    }
    if (payload.postPurchaseQuality && typeof payload.postPurchaseQuality === "object") {
      for (const [k, v] of Object.entries(payload.postPurchaseQuality)) result[`quality.post.${k}`] = v;
    }
    result["quality.status"] = q?.status;
  } catch (err) {
    result["quality.error"] = err instanceof Error ? err.message : String(err);
  }

  if (withInventory) {
    try {
      const inv = await client.getInventory(String(sku));
      result["inventory.amount"] = inv?.quantity?.amount;
      result["inventory.unit"] = inv?.quantity?.unit;
    } catch (err) {
      result["inventory.error"] = err instanceof Error ? err.message : String(err);
    }
  }

  if (withContent && base?.gtin) {
    try {
      const catalog = await client.searchWalmartCatalog({ gtin: String(base.gtin) });
      result["content.title"] = catalog?.title;
      result["content.brand"] = catalog?.brand;
      result["content.description_chars"] = catalog?.description?.length;
      result["content.images_count"] = Array.isArray(catalog?.images) ? catalog.images.length : 0;
    } catch (err) {
      result["content.error"] = err instanceof Error ? err.message : String(err);
    }
  }

  if ((i + 1) % 25 === 0 || i + 1 === skus.length) {
    console.error(`[phase 2] ${i + 1}/${skus.length} SKUs enriched`);
  }
  return result;
});

// ---------- Phase 3: write file + summary ----------
console.error(`\n[phase 3] writing ${enriched.length} rows to ${outputPath}...`);
if (format === "json") {
  writeFileSync(outputPath, JSON.stringify(enriched, null, 2));
} else {
  writeFileSync(outputPath, toCSV(enriched));
}

// Summary stats
const withQuality = enriched.filter((r) => typeof r["quality.overall"] === "number");
const avgQuality = withQuality.length
  ? withQuality.reduce((s, r) => s + r["quality.overall"], 0) / withQuality.length
  : null;
const bottomQ = withQuality
  .sort((a, b) => (a["quality.overall"] || 0) - (b["quality.overall"] || 0))
  .slice(0, 5);
const failedQuality = enriched.filter((r) => r["quality.error"]).length;

// stdout summary — this is what the LLM sees
console.log("\nDone.");
console.log(`SKUs unique: ${skus.length}`);
console.log(`Pages fetched: ${pageNum}`);
console.log(`Duplicates dropped: ${totalSeen - skus.length}`);
if (avgQuality !== null) console.log(`Avg quality (${withQuality.length} SKUs): ${avgQuality.toFixed(1)}`);
if (failedQuality) console.log(`Quality-fetch failures: ${failedQuality}`);
if (bottomQ.length > 0) {
  console.log(`\nBottom 5 by overall quality:`);
  for (const r of bottomQ) {
    console.log(`  ${r.sku.padEnd(20)}  overall=${r["quality.overall"]?.toFixed?.(1) ?? "?"}  productName="${(r.productName || "").slice(0, 50)}"`);
  }
}
console.log(`\nOutput: ${outputPath}`);
