---
name: walmart-audit-store
description: Run a full-store listing audit — paginate all SKUs, fetch per-SKU listing quality scores, identify unpublished items + critical issues, write to CSV/Excel. Use when user asks to "audit", "review", "盘点", "全店检查", or asks about overall store health. NEVER attempt this entirely in chat for stores >30 SKUs — context budget will exhaust.
disable-model-invocation: true
---

# walmart-audit-store

End-to-end store audit workflow. The user gets back a structured file they can open in Excel; the LLM only sees the audit summary.

## When to use
User says any of:
- "盘点全店" / "audit my store" / "review all listings"
- "找出问题 SKU" / "which listings need work"
- "整体质量分" / "listing quality across my store"

## Decision: chat vs script

Get the SKU count first by calling `walmart_get_items` with `limit=1` (or look at any prior context).

| SKU count | Path |
|---|---|
| **≤ 20** | Chat-orchestrated — iterate sequentially with `walmart_get_items` + `walmart_get_listing_quality_score({sku})` per SKU. Report findings directly. |
| **> 20** | Delegate to `scripts/audit-store.mjs`. Do NOT loop in chat. |

## Script path (most common)

1. Inform the user: "Running full-store audit. Will write the result to a CSV — you'll see it in `<output path>`."

2. Run the script via Bash:

```bash
node scripts/audit-store.mjs --output store-audit-$(date +%Y-%m-%d).csv
```

Options the user may want:
- `--with-inventory` — also fetch per-SKU inventory quantity (slower, more API calls)
- `--with-content` — also fetch Walmart public catalog content (title/desc/images) per SKU's GTIN
- `--format json` — JSON instead of CSV
- `--concurrency 5` — bump from default 3 (watch rate limits)
- `--limit 10` — cap pages, useful for a quick smoke test

3. Read ONLY the stdout summary (script prints "Done. SKUs unique: ..., Avg quality: ..., Bottom 5 ..."). **Do NOT cat the CSV** — it can be 100KB+ and will blow context.

4. Help the user interpret:
   - Avg quality < 60 → store-wide content/pricing/shipping issues
   - Bottom-5 SKUs are the highest-ROI listings to optimize first
   - `unpublishedReasons` column shows why each UNPUBLISHED SKU isn't live
   - `quality.contentScore` low → description/images need work; use `walmart-diagnose-sku` skill on those
   - `quality.offerScore` low → pricing competitiveness; needs repricing strategy
   - `quality.ratingReviewScore` low → need Review Accelerator enrollment (separate workflow)

5. Suggest next actions based on what the audit revealed. Common next steps:
   - "Want me to deep-dive into the bottom 5 with walmart-diagnose-sku?"
   - "Want me to draft fixes for the UNPUBLISHED items?"

## Chat path (small stores only)

If ≤ 20 SKUs, you can iterate in chat:

```
1. walmart_get_items({}) → collect SKUs from first page (dedup via Set)
2. If response.nextCursor: walmart_get_items({nextCursor: ...}) → repeat
3. For each unique SKU: walmart_get_listing_quality_score({sku})
4. Summarize: sort by overAllQuality ascending, report bottom 3
```

Even at ≤ 20 SKUs, prefer the script if user wants a saved file.

## Anti-patterns

- ❌ Calling `walmart_get_items` with parallel different `offset` values (production returns duplicates; CLAUDE.md ref)
- ❌ `cat`ing the audit CSV into your reply (context bloat — keep the file on disk)
- ❌ Iterating > 30 SKUs in chat (context budget)
- ❌ Skipping the dedupe step (sandbox-confirmed: cursor pagination can re-emit same page)

## Output to user
Lead with the summary numbers + bottom-5. End with concrete next-step suggestions tied to which sub-score is weakest.
