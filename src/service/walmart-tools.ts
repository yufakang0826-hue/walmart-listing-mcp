import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { serializeError, serializeSuccess } from "../helper/format.js";
import { authService } from "./auth-service.js";

type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

const paramsSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

interface ToolDefinition<TInput extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: TInput;
  outputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}

function registerTool<TInput extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  def: ToolDefinition<TInput>,
): void {
  const source = def.annotations.openWorldHint ? "external" : "local";

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      annotations: def.annotations,
    },
    // Cast bridges the SDK's ToolCallback (Args=unknown shape) with our
    // z.infer<TInput> argument typing — behavior is unchanged.
    (async (input: z.infer<TInput>) => {
      try {
        return serializeSuccess(await def.handler(input), source) as CallToolResult;
      } catch (error) {
        return serializeError(error) as CallToolResult;
      }
    }) as Parameters<typeof server.registerTool>[2],
  );
}

async function withClient<T>(
  sellerProfileId: string | undefined,
  handler: (client: ReturnType<typeof authService.createClient>) => Promise<T>,
): Promise<T> {
  const client = authService.createClient(sellerProfileId);
  return handler(client);
}

// Annotation presets — keep one source of truth so reviewers can audit
// behavior hints at a glance. Per MCP spec, destructiveHint / idempotentHint
// are only meaningful when readOnlyHint is false, so the READ_* presets
// omit them.
const READ_LOCAL: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

const READ_REMOTE: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

// Local writes that overwrite existing state (e.g. upsert_seller_profile
// can replace credentials of an existing profile).
const WRITE_LOCAL_DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

// Local writes that only flip a flag / change selection (e.g.
// set_active_seller_profile). Reversible, no data is lost.
const WRITE_LOCAL_SAFE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_REMOTE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_REMOTE_NONIDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// Output-schema presets. Walmart response shapes are large and partially
// undocumented, so we list the fields agents actually rely on and use
// .passthrough() to keep the rest available without making the schema brittle.
const sellerProfileShape = z
  .object({
    sellerProfileId: z.string(),
    sellerProfileLabel: z.string().optional(),
    marketplace: z.string(),
    channelType: z.string().nullable().optional(),
    consumerId: z.string().nullable().optional(),
    svcEnv: z.string(),
    hasClientId: z.boolean(),
    hasClientSecret: z.boolean(),
    isActive: z.boolean(),
    updatedAt: z.string(),
  })
  .passthrough();

const tokenStatusShape = z
  .object({
    authenticated: z.boolean(),
    hasClientCredentials: z.boolean(),
    usingSellerProfileStore: z.boolean(),
    sellerProfileId: z.string().nullable(),
    sellerProfileLabel: z.string().nullable(),
    activeSellerProfileId: z.string().nullable(),
    marketplace: z.string(),
    sandbox: z.boolean(),
    availableSellerProfiles: z.array(z.string()),
  })
  .passthrough();

const walmartItemListShape = z
  .object({
    ItemResponse: z.array(z.unknown()).optional(),
    totalItems: z.number().optional(),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough();

const walmartFeedSubmitShape = z
  .object({
    feedId: z.string().optional(),
  })
  .passthrough();

const walmartFeedStatusShape = z
  .object({
    feedId: z.string().optional(),
    feedStatus: z.string().optional(),
    feedSource: z.string().optional(),
    itemsReceived: z.number().optional(),
    itemsSucceeded: z.number().optional(),
    itemsFailed: z.number().optional(),
    itemsProcessing: z.number().optional(),
  })
  .passthrough();

const passthroughShape = z.object({}).passthrough();

const successShape = z
  .object({
    success: z.boolean(),
  })
  .passthrough();

// walmart_search_walmart_catalog response. Walmart returns two distinct
// shapes:
//   - Single match (gtin/upc/asin): the product record directly with keys
//     itemId, title, brand, description (HTML), images (array of {url}),
//     price ({amount, currency}), freeShipping, isMarketPlaceItem,
//     offerCount, productType, properties (category attrs).
//   - Multi match (keyword query): { items: [...] }, often empty in sandbox.
// We use passthrough + permissive nested types because amount can come back
// as either number or string depending on locale, and properties is a free-
// form bag whose keys vary by category.
const walmartCatalogItemShape = z
  .object({
    itemId: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    brand: z.string().optional(),
    description: z.string().optional(),
    images: z.array(z.unknown()).optional(),
    price: z.unknown().optional(),
    freeShipping: z.boolean().optional(),
    isMarketPlaceItem: z.boolean().optional(),
    offerCount: z.union([z.string(), z.number()]).optional(),
    productType: z.string().optional(),
    properties: z.unknown().optional(),
    items: z.array(z.unknown()).optional(),
  })
  .passthrough();

// Shared field schemas — used in many tools.
const sellerProfileIdField = z
  .string()
  .optional()
  .describe("Optional seller profile ID. If omitted, the active profile is used.");

const skuField = z.string().describe("Seller SKU.");

export async function registerWalmartTools(server: McpServer): Promise<void> {
  registerAuthTools(server);
  registerListingTools(server);
}

function registerAuthTools(server: McpServer): void {
  registerTool(server, {
    name: "walmart_upsert_seller_profile",
    description: "Create or update a Walmart seller profile. Stores clientId, clientSecret, marketplace, channelType, consumerId, and svcEnv locally.",
    annotations: WRITE_LOCAL_DESTRUCTIVE,
    inputSchema: z
      .object({
        sellerProfileId: z.string().describe("Seller profile ID, for example walmart-us-main."),
        sellerProfileLabel: z.string().optional().describe("Optional human-readable label for the seller profile."),
        marketplace: z.string().optional().describe("Marketplace code such as US, CA, or MX."),
        clientId: z.string().optional().describe("Optional Walmart client ID."),
        clientSecret: z.string().optional().describe("Optional Walmart client secret."),
        channelType: z.string().optional().describe("Optional WM_CONSUMER.CHANNEL.TYPE (Consumer Channel Type UUID) from Walmart Developer Portal."),
        consumerId: z.string().optional().describe("Optional WM_CONSUMER.ID (Consumer ID) from Walmart Developer Portal. Required by Walmart routing layer for feeds."),
        svcEnv: z.string().optional().describe("Optional WM_SVC.ENV value. Defaults to 'prod' (or 'stg' when WALMART_SANDBOX=true)."),
        setActive: z.boolean().default(true).describe("Whether to make this profile active immediately."),
      })
      .strict(),
    outputSchema: sellerProfileShape,
    handler: async (input) =>
      authService.upsertSellerProfile({
        sellerProfileId: input.sellerProfileId,
        sellerProfileLabel: input.sellerProfileLabel,
        marketplace: input.marketplace,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        channelType: input.channelType,
        consumerId: input.consumerId,
        svcEnv: input.svcEnv,
        setActive: input.setActive,
      }),
  });

  registerTool(server, {
    name: "walmart_list_seller_profiles",
    description: "List all seller profiles stored locally in .walmart-seller-profiles.json, indicating which one is currently active. Use at the start of a multi-store session to see what's available + which profile listing tools will default to. Profile content (clientId/clientSecret presence, marketplace, svcEnv) is included but secrets are not echoed.",
    annotations: READ_LOCAL,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ sellerProfiles: z.array(sellerProfileShape) }).passthrough(),
    handler: async () => ({ sellerProfiles: authService.listSellerProfiles() }),
  });

  registerTool(server, {
    name: "walmart_set_active_seller_profile",
    description: "Switch the default seller profile used by every other tool when its sellerProfileId arg is omitted. Use when toggling between multiple Walmart store accounts. Reversible — just call again with a different profile id. Does NOT modify any Walmart-side data, only local profile state.",
    annotations: WRITE_LOCAL_SAFE,
    inputSchema: z
      .object({ sellerProfileId: z.string().describe("Seller profile ID to activate.") })
      .strict(),
    outputSchema: z
      .object({ success: z.boolean(), activeSellerProfile: sellerProfileShape })
      .passthrough(),
    handler: async (input) => ({
      success: true,
      activeSellerProfile: authService.setActiveSellerProfile(input.sellerProfileId),
    }),
  });

  registerTool(server, {
    name: "walmart_get_token_status",
    description: "Inspect the server's current auth state: which profile is active, whether credentials are loaded, whether using the local profile store, marketplace + sandbox flags, and the list of available profile ids. Read-only diagnostic — does NOT fetch a token. Use to debug 'why is my Walmart call failing — is it auth, network, or business?' before calling walmart_verify_credentials.",
    annotations: READ_LOCAL,
    inputSchema: z.object({ sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: tokenStatusShape,
    handler: async (input) => authService.getTokenStatus(input.sellerProfileId),
  });

  registerTool(server, {
    name: "walmart_verify_credentials",
    description: "Smoke-test the configured Walmart credentials by attempting one OAuth token exchange. Use as the first call in a new session to confirm credentials are set + the network can reach Walmart + the token endpoint isn't rate-limiting you. Does NOT touch any business data. Returns { tokenType: 'Bearer', expiresIn, ...} on success or an error describing whether it's a credential issue vs an upstream Walmart problem.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: z
      .object({ ok: z.boolean().optional(), success: z.boolean().optional() })
      .passthrough(),
    handler: async (input) => authService.verifyCredentials(input.sellerProfileId),
  });
}

function registerListingTools(server: McpServer): void {
  registerTool(server, {
    name: "walmart_get_items",
    description: "List Walmart items for the active seller profile. PAGINATION: Walmart uses CURSOR-based pagination, not offset. Call once with no cursor to get the first page + response.nextCursor; then call again with nextCursor set to the previous response's value to advance. Repeat until nextCursor is null/empty. NEVER fan out parallel calls with different offset values — production has been observed to return duplicate SKUs across offset pages because the offset boundary is not strict. For a full-store walk: iterate sequentially with nextCursor, dedupe by sku as a safety net, and process per-page rather than buffering everything into agent context.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        limit: z.number().optional().describe("Optional page size hint. Walmart may return fewer or more; the actual count is in the response."),
        nextCursor: z.string().optional().describe("Pagination cursor from a previous response's nextCursor field. Omit on first call. Use this — NOT offset — to walk multiple pages."),
        offset: z.number().optional().describe("DEPRECATED — Walmart's offset is not strict and parallel calls with different offsets cause overlapping/duplicate SKUs in production. Use nextCursor instead. Kept for backward compat only."),
        sku: z.string().optional().describe("Optional SKU filter."),
        lifecycleStatus: z.string().optional().describe("Optional lifecycle status filter (ACTIVE / RETIRED / etc.)."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: walmartItemListShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getItems({
          limit: input.limit,
          nextCursor: input.nextCursor,
          offset: input.offset,
          sku: input.sku,
          lifecycleStatus: input.lifecycleStatus,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_item",
    description: "Get the full seller-side metadata record for a SKU: sku, wpid, gtin, mart, availability, publishedStatus, lifecycleStatus, isDuplicate, unpublishedReasons[], productName, price. Returns 404 if you don't own the SKU. Does NOT return product content like description / images / brand — for those use walmart_search_walmart_catalog({ gtin }). For status-only summary use walmart_get_item_status (lighter). For an everything-in-one-call composite use walmart_get_complete_item.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getItem(input.sku)),
  });

  registerTool(server, {
    name: "walmart_search_walmart_catalog",
    description: "Search the Walmart PUBLIC catalog (not your seller catalog) for full product content — title, description, images, brand, price, properties. Provide at least one of query, gtin, upc, or asin. Use this when you need product details that walmart_get_item does not return (description, images, brand, attributes). Single-identifier lookups (gtin/upc/asin) return the product record directly; keyword queries return { items: [...] }.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        query: z.string().optional().describe("Keyword search, e.g. 'iPad Pro 11 inch'. Returns up to 20 items wrapped in { items: [...] }."),
        gtin: z.string().optional().describe("Global Trade Item Number — 14-digit, e.g. '00193514013203'. Returns the product record directly."),
        upc: z.string().optional().describe("Universal Product Code — typically 12-digit. Returns the product record directly."),
        asin: z.string().optional().describe("Amazon Standard Identification Number. Returns the product record directly."),
        responseFormat: z.enum(["DEFAULT", "SPEC"]).optional().describe("DEFAULT returns the product summary; SPEC returns the category attribute template needed to list a similar item."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: walmartCatalogItemShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.searchWalmartCatalog({
          query: input.query,
          gtin: input.gtin,
          upc: input.upc,
          asin: input.asin,
          responseFormat: input.responseFormat,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_listing_quality_score",
    description: "Walmart Insights — listing quality scores. Omit sku/itemId to get the store-wide aggregate (score, postPurchaseQuality, overAllQuality across all SKUs). Pass sku OR itemId to scope the response to a single SKU's quality breakdown (content/pricing/shipping/rating/offer sub-scores).",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        sku: z.string().optional().describe("Seller SKU — scopes the response to a single SKU's quality breakdown."),
        itemId: z.string().optional().describe("Walmart itemId — alternative to sku, scopes to a single item."),
        viewTrendingItems: z.boolean().optional().describe("If true, focus on trending items only (store-wide mode)."),
        wfsFlag: z.string().optional().describe("Optional WFS (Walmart Fulfillment Services) filter."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: z
      .object({
        status: z.string().optional(),
        payload: z.unknown().optional(),
      })
      .passthrough(),
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getListingQualityScore({
          sku: input.sku,
          itemId: input.itemId,
          viewTrendingItems: input.viewTrendingItems,
          wfsFlag: input.wfsFlag,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_search_my_catalog",
    description: "Search YOUR seller catalog by a single field. Uses POST /v3/items/catalog/search with body { query: { field, values }, sort?, filter? }. Returns up to 20 items as a flat array with fields like sku, gtin, wpid, lifecycleStatus, publishedStatus, inventoryStatus, productName, shelf, itemId, price. KNOWN PRODUCTION ISSUE: this endpoint works against Walmart sandbox but production reports 400 'Please provide at least one Valid Query/Filters' for the same body shape — Walmart sandbox vs production divergence. If it fails in production, use walmart_get_items (which supports lifecycleStatus filter) instead.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        field: z.enum(["productName", "sku", "gtin", "upc", "wpid", "itemId"]).describe("The field to search against. Walmart sandbox accepts only these field names."),
        values: z.array(z.string()).min(1).describe("Search values. Use ['%'] to match all (e.g. when only filtering/sorting). Use literal values for exact match — e.g. ['ZTGY-058'] when field='sku'."),
        sort: z
          .array(
            z.object({
              field: z.enum(["lifecycleStatus", "publishedStatus", "inventoryStatus", "price"]),
              order: z.enum(["ASC", "DESC"]),
            }),
          )
          .optional()
          .describe("Sort clauses, in priority order. Allowed fields: lifecycleStatus, publishedStatus, inventoryStatus, price."),
        filter: z
          .unknown()
          .optional()
          .describe("Optional filter clause. Exact shape is undocumented by Walmart and not validated by sandbox; passed through as-is to the API. Try variants like [{ field: 'lifecycleStatus', values: ['ACTIVE'] }] if the basic query fails in production."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.searchMyCatalog({
          query: { field: input.field, values: input.values },
          sort: input.sort,
          filter: input.filter,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_item_status",
    description: "Get derived status fields for a SKU: publishedStatus (PUBLISHED/UNPUBLISHED), lifecycleStatus (ACTIVE/RETIRED), availability (In_stock/Out_of_stock), isDuplicate, unpublishedReasons. Lighter than walmart_get_item — strips the full item record down to status-relevant fields only. Returns 404 if the SKU is not in your account.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: z
      .object({
        sku: z.string().optional(),
        publishedStatus: z.string().optional(),
        lifecycleStatus: z.string().optional(),
        availability: z.string().optional(),
      })
      .passthrough(),
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getItemStatus(input.sku)),
  });

  registerTool(server, {
    name: "walmart_get_complete_item",
    description: "One-call composite: fetch the full picture of a SKU by orchestrating 4 API calls in parallel — get_item_status (publication state), get_inventory (quantity), get_listing_quality_score (per-SKU quality breakdown), and walmart_search_walmart_catalog by gtin (title/description/images/brand/price). Each sub-section reports its own status; partial failures do NOT fail the whole call. Use this instead of asking the LLM to chain 4 separate tool calls when you want a SKU's complete state.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: z
      .object({
        sku: z.string(),
        item: z.object({ ok: z.boolean() }).passthrough().optional(),
        inventory: z.object({ ok: z.boolean() }).passthrough().optional(),
        qualityScore: z.object({ ok: z.boolean() }).passthrough().optional(),
        catalogContent: z.object({ ok: z.boolean() }).passthrough().optional(),
        notes: z.array(z.string()).optional(),
      })
      .passthrough(),
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => {
        const notes: string[] = [];

        // Fan out 3 calls in parallel. get_item gives us both the seller-side
        // metadata AND the gtin needed for the catalog content lookup, so we
        // avoid calling get_item twice (vs. calling get_item_status first then
        // get_item separately for the gtin).
        const [itemR, inventoryR, qualityR] = await Promise.allSettled([
          client.getItem(input.sku),
          client.getInventory(input.sku),
          client.getListingQualityScore({ sku: input.sku }),
        ]);

        let gtin: string | undefined;
        if (itemR.status === "fulfilled") {
          const ir = itemR.value as
            | { ItemResponse?: Array<{ gtin?: string }> }
            | undefined;
          const first = ir?.ItemResponse?.[0];
          if (first && typeof first.gtin === "string") gtin = first.gtin;
          else notes.push("get_item returned but no gtin field — catalog content lookup skipped.");
        } else {
          notes.push(`get_item failed: ${itemR.reason instanceof Error ? itemR.reason.message : String(itemR.reason)}`);
        }

        let catalogR: PromiseSettledResult<unknown> | null = null;
        if (gtin) {
          catalogR = await Promise.allSettled([
            client.searchWalmartCatalog({ gtin }),
          ]).then((arr) => arr[0]);
        }

        function settled(r: PromiseSettledResult<unknown> | null): { ok: boolean } & Record<string, unknown> {
          if (!r) return { ok: false, error: "skipped" };
          if (r.status === "fulfilled") {
            const v = r.value;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              return { ok: true, ...(v as Record<string, unknown>) };
            }
            return { ok: true, value: v };
          }
          return {
            ok: false,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          };
        }

        return {
          sku: input.sku,
          item: settled(itemR),
          inventory: settled(inventoryR),
          qualityScore: settled(qualityR),
          catalogContent: settled(catalogR),
          ...(notes.length > 0 ? { notes } : {}),
        };
      }),
  });

  registerTool(server, {
    name: "walmart_retire_item",
    description: "Retire (delist) a single SKU. The item transitions to lifecycleStatus=RETIRED + publishedStatus=UNPUBLISHED. Idempotent — retiring an already-retired SKU is a no-op. TO REACTIVATE: there is no dedicated reactivate endpoint; re-submit the full MP_ITEM feed payload via walmart_submit_feed({ feedType: 'MP_ITEM', payload: <full record> }) and the item will return to ACTIVE after feed processing (24–48h for full republication). For bulk retire across many SKUs, use walmart_submit_feed with feedType='MP_RETIRE_ITEM' instead — fewer API calls.",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: successShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => ({
        success: true,
        result: await client.retireItem(input.sku),
      })),
  });

  registerTool(server, {
    name: "walmart_submit_feed",
    description: "Submit a Walmart feed — the canonical path for ALL listing writes (create item, update content, bulk inventory, bulk price, retire, reactivate). Walmart has no direct per-SKU POST/PUT for item content. Common feedTypes: MP_ITEM (new listing OR reactivate retired one — re-submit full payload), MP_ITEM_MATCH (offer on existing Walmart catalog item, lighter payload), MP_MAINTENANCE (partial update to existing SKU), MP_RETIRE_ITEM (bulk retire), inventory / MP_INVENTORY (single-FC / multi-FC stock), price / PROMO_PRICE / PRICE_AND_PROMOTION (price + promo). Returns a feedId immediately; the feed itself processes asynchronously — ALWAYS follow up with walmart_get_feed_status to confirm processing succeeded (a 200 here only means Walmart accepted the submission, not that the items inside validated). Payload is object for JSON or string for XML.",
    // Each submission creates a new feed with a new feedId — not idempotent.
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        feedType: z.string().describe("Feed type, for example MP_ITEM or price."),
        payload: z.union([z.record(z.unknown()), z.string()]).describe("Exact Walmart feed payload body. Object for JSON feeds; string for XML feeds. Required."),
        params: paramsSchema.describe("Optional extra query parameters such as feedVersion or locale."),
        contentType: z.string().optional().describe("Optional feed content type. Defaults to application/json, set to application/xml for XML feeds, application/zip for bulk feeds."),
        filename: z.string().optional().describe("Optional filename for the multipart upload. Defaults to feed.json/feed.xml/feed.zip based on contentType."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: walmartFeedSubmitShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.submitFeed(input.feedType, input.payload, input.params, {
          contentType: input.contentType,
          filename: input.filename,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_feed_status",
    description: "Get Walmart feed processing details by feedId. Returns feedStatus (RECEIVED / INPROGRESS / PROCESSED / ERROR), itemsReceived, itemsSucceeded, itemsFailed, itemsProcessing, plus per-item error details. Use after walmart_submit_feed to confirm whether items inside the feed actually validated and published — submit_feed returning a feedId only means Walmart accepted the submission. Polling cadence: every 30s for the first 5 min; if still INPROGRESS, fall back to every few minutes.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        feedId: z.string().describe("Feed ID returned by Walmart."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: walmartFeedStatusShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getFeedStatus(input.feedId)),
  });

  registerTool(server, {
    name: "walmart_get_feeds",
    description: "List the most recent Walmart feeds for the active seller profile, with their feedStatus / processing counts. Use for: (a) auditing recent upload activity, (b) finding feedIds for past submissions to replay or inspect, (c) finding the most recent successfully PROCESSED MP_ITEM feed as a template payload reference. Filter by feedType to narrow (e.g. only MP_ITEM history).",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        feedType: z.string().optional().describe("Optional feed type filter."),
        limit: z.number().optional().describe("Optional page size."),
        offset: z.number().optional().describe("Optional offset."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: z
      .object({
        results: z.object({ feed: z.array(walmartFeedStatusShape).optional() }).passthrough().optional(),
        totalResults: z.number().optional(),
      })
      .passthrough(),
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getFeeds({
          feedType: input.feedType,
          limit: input.limit,
          offset: input.offset,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_taxonomy",
    description: "Get the Walmart category taxonomy tree for a feedType (MP_ITEM default) and version (4.2 default). Use when building a new MP_ITEM payload to identify the correct category path + which category-specific attributes Walmart requires. This is the closest substitute for /v3/items/specs (which is not exposed in sandbox).",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        feedType: z.string().optional().describe("Feed type, defaults to MP_ITEM."),
        version: z.string().optional().describe("Taxonomy version. Defaults to 4.2 (the version Walmart sandbox accepts; 5.0 returns 400 INVALID_REQUEST in current sandbox)."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.getTaxonomy(input.feedType, input.version)),
  });

  registerTool(server, {
    name: "walmart_get_departments",
    description: "List the top-level Walmart department / super-department structure (e.g. 'PERSONAL CARE' → 'ORAL CARE'). Use as a category navigator when the user is exploring where to place a new listing. KNOWN PRODUCTION ISSUE: Walmart's midas-data-api backend has been returning 520 SYSTEM_ERROR for this endpoint in production. Sandbox works fine. If production 520s, use walmart_get_taxonomy instead — it returns the same category structure plus the per-category attribute schemas.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getDepartments()),
  });

  registerTool(server, {
    name: "walmart_get_inventory",
    description: "Get current inventory quantity for a single SKU (default ship node). Returns { sku, quantity: { amount, unit } }. Walmart's /v3/inventory endpoint requires sku — there is NO bulk-list endpoint, so to enumerate all inventory you must iterate via walmart_get_items + per-SKU walmart_get_inventory. For large catalogs, use scripts/audit-store.mjs --with-inventory.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getInventory(input.sku)),
  });

  registerTool(server, {
    name: "walmart_update_inventory",
    description: "Update inventory for a single SKU at the default ship node. Walmart payload shape: { sku, quantity: { unit: 'EACH', amount: <number> } }. PUT-style idempotent (same payload → same end state). For multi-FC inventory, use walmart_submit_feed with feedType='MP_INVENTORY' instead. Returns the updated record on success.",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z
      .object({
        sku: skuField,
        payload: z.record(z.unknown()).describe("Inventory request body. Must follow Walmart's /v3/inventory body shape. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.updateInventory(input.sku, input.payload)),
  });

  registerTool(server, {
    name: "walmart_update_price",
    description: "Update standard price for a single SKU. Walmart payload shape: { Price: { itemIdentifier: { sku, productIdType: 'SKU' }, pricingList: { pricing: [{ currentPrice: { value: { amount, currency: 'USD' } } }] } } }. For promotional pricing (sale, clearance, reduced), use walmart_submit_feed with feedType='PROMO_PRICE'. For bulk updates across many SKUs, use feedType='price' or 'PRICE_AND_PROMOTION'. Idempotent for repeated identical calls.",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z
      .object({
        payload: z.record(z.unknown()).describe("Price request body. Must follow Walmart's /v3/price body shape. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.updatePrice(input.payload)),
  });
}
