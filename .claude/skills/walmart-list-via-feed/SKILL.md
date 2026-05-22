---
name: walmart-list-via-feed
description: Create or update one or many Walmart listings via the MP_ITEM feed. Use when user wants to add a new product, fix an unpublished item's missing fields (shipping/image/tax/etc.), or bulk-update existing listings. This is the canonical path for all write operations to listing content — Walmart's API has no direct per-SKU POST/PUT, everything goes through feeds.
---

# walmart-list-via-feed

Walmart's seller API is feed-based for all listing writes. There is no `POST /v3/items` or `PUT /v3/items/{sku}` — confirmed via sandbox probe. This skill is the orchestration for using `walmart_submit_feed` correctly.

## When to use
- "上新" / "create a new listing"
- "改商品描述/图片/价格" / "edit listing content"
- "修复未发布的 SKU" / "fix unpublished items"
- "批量上传" / "bulk upload"

## Process

### Step 1: Decide feed type

| Goal | feedType | Notes |
|---|---|---|
| New listing (full content, GTIN-based) | `MP_ITEM` | Most common; requires productIdentifiers + ShippingWeight + price + shortDescription + a productType-specific attribute set |
| Match offer on existing Walmart catalog item | `MP_ITEM_MATCH` | Quicker than MP_ITEM; only needs sku + GTIN + price + ShippingWeight |
| Partial update to existing listing | `MP_MAINTENANCE` | For changing title/desc/images/attributes on existing SKU |
| Bulk retire | `MP_RETIRE_ITEM` | Alternative to per-SKU `walmart_retire_item` |
| Reactivate retired item | `MP_ITEM` (re-submit full payload) | No "reactivate" endpoint; re-submitting via MP_ITEM lifts RETIRED → ACTIVE |
| Inventory bulk | `inventory` or `MP_INVENTORY` | Single-FC or multi-FC |
| Price bulk | `price`, `PROMO_PRICE`, `PRICE_AND_PROMOTION` | Standard / promo / both |

### Step 2: Get the spec template (when adding new attributes)

If the user is creating a new listing or adding attributes to existing one:

1. First check what the relevant category requires. Walmart sandbox does NOT expose `/v3/items/specs` (404), so use one of these fallbacks:
   - Use `walmart_get_taxonomy({ feedType: "MP_ITEM", version: "4.2" })` to identify the category structure
   - Pull a known-good payload from a recent successful `walmart_get_feeds` entry (the `walmart_get_feed_status` for a PROCESSED feed shows what shape worked)
   - Ask the user for an exemplar SKU from their catalog with similar productType; pull its current data via `walmart_search_walmart_catalog({ gtin })` to see what Walmart accepts

2. Build the payload aligned with the productType the user is targeting.

### Step 3: Construct the payload

Minimal MP_ITEM payload skeleton:

```json
{
  "MPItemFeedHeader": {
    "version": "4.2",
    "sellingChannel": "marketplace",
    "locale": "en"
  },
  "MPItem": [
    {
      "Item": {
        "sku": "<your-sku>",
        "productIdentifiers": { "productIdType": "GTIN", "productId": "<14-digit-gtin>" },
        "productName": "<title>",
        "ShippingWeight": <number>,
        "price": <number>,
        "shortDescription": "<HTML allowed; use <li> for bullets>",
        "<categoryAttributes>": "..."
      }
    }
  ]
}
```

For XML feeds, payload is a string. `walmart_submit_feed` accepts both via the union schema.

### Step 4: Submit + poll

```
1. feedR = walmart_submit_feed({ feedType: "MP_ITEM", payload: <json-or-xml>, contentType: "application/json" })
2. feedId = feedR.feedId
3. Wait 30s-5min (Walmart processing time varies)
4. status = walmart_get_feed_status({ feedId })
5. Inspect status.feedStatus and itemsSucceeded / itemsFailed
6. If itemsFailed > 0: status response includes per-item error details
```

For fixing unpublished items, the payload should be the COMPLETE item record (not a partial update) when using MP_ITEM. Use MP_MAINTENANCE for partial updates.

### Step 5: Verify

After feed processing completes:

```
walmart_get_item_status({ sku }) → confirm publishedStatus changed
```

For multi-SKU bulk operations, follow up with `walmart-audit-store` skill on the affected SKUs.

## Anti-patterns

- ❌ Submitting a partial payload via MP_ITEM (it expects the FULL record; use MP_MAINTENANCE for partial)
- ❌ Skipping `walmart_get_feed_status` after submit (a 200 from submit_feed only means Walmart accepted the feed for processing — the items may still fail validation)
- ❌ Using `walmart_invoke_listing_api` (does not exist; was removed in v0.2.0)
- ❌ Hardcoding GTIN as 12-digit UPC (Walmart requires 14-digit; pad with leading zeros)
- ❌ Submitting > 1000 items in a single MP_ITEM feed without chunking (Walmart processing time grows non-linearly)

## Reactivate workflow

User says "reactivate SKU X" / "重新上架":

1. Pull the original item data: `walmart_get_item({ sku })` — should show `lifecycleStatus: RETIRED`
2. If you have the original MP_ITEM feed payload, re-submit it
3. If you don't, you'll need to reconstruct: `walmart_search_walmart_catalog({ gtin })` to get Walmart's catalog content, then rebuild the MP_ITEM payload from that + the user's pricing/inventory
4. `walmart_submit_feed({ feedType: "MP_ITEM", payload: ... })`
5. Poll `walmart_get_feed_status` → confirm PROCESSED + itemsSucceeded
6. `walmart_get_item_status({ sku })` → should now show `lifecycleStatus: ACTIVE, publishedStatus: PUBLISHED` (may take 24-48h post-feed for full publication)
