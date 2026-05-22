---
name: walmart-diagnose-sku
description: Deep-dive on a single SKU — pull complete picture (item metadata, inventory, per-SKU quality, public catalog content) and surface specific optimization recommendations. Use when user asks about a specific SKU's status, why it's not selling, why it's unpublished, or how to improve it.
---

# walmart-diagnose-sku

Per-SKU root-cause analysis. One tool call + structured interpretation.

## When to use
User mentions a specific SKU and asks:
- "为啥 SKU X 没发布" / "why is X unpublished"
- "SKU X 怎么优化" / "how do I improve X"
- "SKU X 的状态" / "what's X's status"
- "看看 SKU X" / "check X"

## Process

### Step 1: One composite call

```
walmart_get_complete_item({ sku: "<sku>" })
```

This returns 4 sections in parallel: `item` (metadata + gtin), `inventory`, `qualityScore` (per-SKU), `catalogContent` (Walmart public catalog: title/description/images/brand).

### Step 2: Interpret each section

| Signal | Diagnosis |
|---|---|
| `item.publishedStatus === "UNPUBLISHED"` | List the `unpublishedReasons` array — each entry is a fixable cause |
| `item.lifecycleStatus === "RETIRED"` | Item is delisted; needs MP_ITEM feed re-submission to revive |
| `item.isDuplicate === true` | Walmart flagged as duplicate of existing catalog entry |
| `inventory.amount === 0` | Out of stock — won't show on storefront regardless of quality |
| `qualityScore.payload.score.contentScore < 50` | Description / images / attributes weak → use catalogContent.description as a baseline; identify missing fields |
| `qualityScore.payload.score.offerScore < 50` | Pricing/buy-box weak → check `catalogContent.offerCount` to see competition |
| `qualityScore.payload.score.ratingReviewScore < 50` | Few/no reviews → suggest Review Accelerator enrollment (RAP) |
| `qualityScore.payload.postPurchaseQuality.defectRatio > 0` | Quality complaints — investigate via returns data |
| `catalogContent.title` differs from your submitted productName | Walmart has merged your listing with their catalog version — your seller content may be overridden |
| `catalogContent.images.length < 3` | Walmart catalog is image-poor; consider submitting more via MP_ITEM feed |

### Step 3: Output

Give the user a 5–8 line report:

```
SKU: ZTGY-058
Status: UNPUBLISHED → 4 reasons: missing shipping, no primary image, internal error, no tax code
Inventory: 2 units (low)
Quality: overall 44.7
  contentScore: 64 (acceptable, but description is short)
  offerScore: 50 (mid — only 1 competing offer)
  ratingReviewScore: 14.5 (very low — needs reviews)
Walmart catalog title: "Reusable K Cup Coffee Filter..."
Recommended actions (priority order):
  1. Re-submit via MP_ITEM feed to fix shipping/image/tax — addresses 4 unpublished reasons
  2. Enroll in RAP to lift ratingReviewScore
  3. Bump inventory above 10 units
```

### Step 4: Offer follow-ups

- "Want me to draft the MP_ITEM feed payload to re-submit?" (→ `walmart-list-via-feed` skill)
- "Want me to check 5 more SKUs with the same issue?" (→ short audit on flagged SKUs)

## Anti-patterns

- ❌ Calling `walmart_get_item` + `walmart_get_inventory` + `walmart_get_listing_quality_score` as 3 separate calls when `walmart_get_complete_item` does them in parallel as one composite
- ❌ Trusting `catalogContent.description` as ground truth for your listing (Walmart may show a merged catalog version, not your seller content)
- ❌ Recommending a fix without identifying which sub-score is weakest
