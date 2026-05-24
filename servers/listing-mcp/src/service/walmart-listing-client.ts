import {
  WalmartClientError,
  WalmartHttpClient,
  type QueryParams,
} from "@walmart-mcp/client";

interface WalmartItemRecord {
  sku?: string;
  mart?: string;
  wpid?: string;
  availability?: string;
  publishedStatus?: string;
  lifecycleStatus?: string;
  isDuplicate?: boolean;
  unpublishedReasons?: unknown;
  unpublishedReason?: unknown;
  [key: string]: unknown;
}

interface WalmartItemLookupResponse {
  ItemResponse?: WalmartItemRecord[];
  totalItems?: number;
  [key: string]: unknown;
}

function defaultFeedFilename(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("xml")) return "feed.xml";
  if (lower.includes("zip")) return "feed.zip";
  if (lower.includes("csv")) return "feed.csv";
  if (lower.includes("tab") || lower.includes("tsv")) return "feed.tsv";
  if (lower.includes("octet-stream")) return "feed.bin";
  return "feed.json";
}

/**
 * Walmart Listing API client.
 *
 * Wraps the seller-side endpoints under the Walmart Global Marketplace
 * (items, feeds, inventory, price, taxonomy, insights). Extends the
 * shared @walmart-mcp/client WalmartHttpClient — gets OAuth, market
 * routing, retry, and rate-limit handling for free.
 *
 * Sibling MCP servers (orders / fulfillment / reports / ads) will each
 * provide their own subclass with their domain methods.
 */
export class WalmartListingClient extends WalmartHttpClient {
  async getItems(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/items", params });
  }

  async getItem(sku: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/v3/items/${encodeURIComponent(sku)}` });
  }

  async searchWalmartCatalog(params: {
    query?: string;
    gtin?: string;
    upc?: string;
    asin?: string;
    responseFormat?: "DEFAULT" | "SPEC";
  }): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/items/walmart/search", params });
  }

  async searchMyCatalog(body: {
    query: { field: string; values: string[] };
    filter?: unknown;
    sort?: Array<{ field: string; order: "ASC" | "DESC" }>;
  }): Promise<unknown> {
    return this.request({ method: "POST", path: "/v3/items/catalog/search", body });
  }

  async getListingQualityScore(params?: {
    viewTrendingItems?: boolean;
    wfsFlag?: string;
    sku?: string;
    itemId?: string;
  }): Promise<unknown> {
    return this.request({
      method: "GET",
      path: "/v3/insights/items/listingQuality/score",
      params: params as QueryParams,
    });
  }

  async retireItem(sku: string): Promise<unknown> {
    return this.request({ method: "DELETE", path: `/v3/items/${encodeURIComponent(sku)}` });
  }

  async getItemStatus(sku: string): Promise<unknown> {
    const payload = (await this.getItem(sku)) as WalmartItemLookupResponse;
    const items = Array.isArray(payload?.ItemResponse) ? payload.ItemResponse : [];
    const item = items.find((entry) => entry?.sku === sku);

    if (!item) {
      throw new WalmartClientError(
        404,
        "WALMART_ITEM_NOT_FOUND",
        items.length > 0
          ? `Walmart returned ${items.length} item(s) but none matched SKU ${sku}`
          : `No Walmart item was returned for SKU ${sku}`,
        payload,
      );
    }

    return {
      sku,
      mart: item.mart ?? null,
      wpid: item.wpid ?? null,
      availability: item.availability ?? null,
      publishedStatus: item.publishedStatus ?? null,
      lifecycleStatus: item.lifecycleStatus ?? null,
      isDuplicate: typeof item.isDuplicate === "boolean" ? item.isDuplicate : null,
      unpublishedReasons: item.unpublishedReasons ?? item.unpublishedReason ?? null,
    };
  }

  async submitFeed(
    feedType: string,
    payload: unknown,
    params?: QueryParams,
    options?: { contentType?: string; filename?: string },
  ): Promise<unknown> {
    const mimeType = options?.contentType
      || (typeof payload === "string" && payload.trim().startsWith("<")
        ? "application/xml"
        : "application/json");
    const filename = options?.filename || defaultFeedFilename(mimeType);

    return this.request({
      method: "POST",
      path: "/v3/feeds",
      params: { feedType, ...(params || {}) },
      body: payload,
      fileUpload: { filename, mimeType },
    });
  }

  async getTaxonomy(feedType = "MP_ITEM", version = "4.2"): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/utilities/taxonomy", params: { feedType, version } });
  }

  async getDepartments(): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/utilities/taxonomy/departments" });
  }

  async getUnpublishedItemsCounts(): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/insights/items/unpublished/counts" });
  }

  async getFeedStatus(feedId: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/v3/feeds/${encodeURIComponent(feedId)}`, params: { includeDetails: true } });
  }

  async getFeeds(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/feeds", params });
  }

  async getInventory(sku: string): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/inventory", params: { sku } });
  }

  async updateInventory(sku: string, payload: unknown): Promise<unknown> {
    return this.request({ method: "PUT", path: "/v3/inventory", params: { sku }, body: payload });
  }

  /**
   * PUT /v3/price?promo=false — standard (base) price update for a single SKU.
   * v1.0.0 uses the Global API flat payload schema (Pricing & Promotions API,
   * spec 5.0.20250801-18_47_55):
   *   { sku, pricing: [{ currentPrice: { currency, amount }, currentPriceType,
   *                       priceDisplayCodes, processMode }] }
   * The legacy nested payload (Price.itemIdentifier.pricingList.pricing[i].currentPrice.value)
   * was deprecated 2025-10-24 with a 2026 sunset.
   */
  async updatePrice(payload: unknown): Promise<unknown> {
    return this.request({ method: "PUT", path: "/v3/price", params: { promo: "false" }, body: payload });
  }

  /**
   * PUT /v3/price?promo=true — promotional / reduced / clearance price for a
   * single SKU. Payload extends the standard shape with effectiveDate /
   * expirationDate and currentPriceType=REDUCED|CLEARANCE plus a
   * comparisonPrice element. Single endpoint, Global API across us|mx|ca|cl
   * (Walmart docs: update-promotional-price-for-a-single-item).
   */
  async updatePromoPrice(payload: unknown): Promise<unknown> {
    return this.request({ method: "PUT", path: "/v3/price", params: { promo: "true" }, body: payload });
  }
}
