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
    description: "List locally stored Walmart seller profiles and indicate which one is active.",
    annotations: READ_LOCAL,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ sellerProfiles: z.array(sellerProfileShape) }).passthrough(),
    handler: async () => ({ sellerProfiles: authService.listSellerProfiles() }),
  });

  registerTool(server, {
    name: "walmart_set_active_seller_profile",
    description: "Set the active Walmart seller profile used by listing tools when sellerProfileId is omitted.",
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
    description: "Show the current Walmart authentication status used by this MCP server.",
    annotations: READ_LOCAL,
    inputSchema: z.object({ sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: tokenStatusShape,
    handler: async (input) => authService.getTokenStatus(input.sellerProfileId),
  });

  registerTool(server, {
    name: "walmart_verify_credentials",
    description: "Verify that the configured Walmart clientId and clientSecret can fetch an access token.",
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
    description: "List Walmart items for the active seller profile.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        limit: z.number().optional().describe("Optional page size."),
        offset: z.number().optional().describe("Optional offset."),
        sku: z.string().optional().describe("Optional SKU filter."),
        lifecycleStatus: z.string().optional().describe("Optional lifecycle status filter."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: walmartItemListShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getItems({
          limit: input.limit,
          offset: input.offset,
          sku: input.sku,
          lifecycleStatus: input.lifecycleStatus,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_item",
    description: "Get a single Walmart item by SKU. Returns seller-side metadata (publishedStatus, lifecycleStatus, wpid, etc.) — NOT product content like description/images/brand. For product content use walmart_search_walmart_catalog.",
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
    description: "Walmart Insights — listing quality scores. Sandbox response: { payload: { score, postPurchaseQuality, overAllQuality }, status }. This is the API equivalent of the Listing Quality and Pricing Insights dashboards in Seller Center.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        viewTrendingItems: z.boolean().optional().describe("If true, focus on trending items only."),
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
    description: "Get Walmart item status fields by SKU using the item lookup response.",
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
    name: "walmart_retire_item",
    description: "Retire or delist a Walmart item by SKU.",
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
    description: "Submit a Walmart feed for listing operations. Payload is uploaded as multipart/form-data (Walmart API requirement). Common feedType values include MP_ITEM and price.",
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
    description: "Get Walmart feed processing status by feed ID.",
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
    description: "List Walmart feeds for the active seller profile.",
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
    description: "Get Walmart taxonomy data for listing category work.",
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
    description: "Get Walmart departments used for listing taxonomy navigation. KNOWN PRODUCTION ISSUE: Walmart's midas-data-api backend has been returning 520 SYSTEM_ERROR for this endpoint in production for at least 24h as of v0.3.3. Sandbox works fine. If this 520s in production, use walmart_get_taxonomy as a workaround — it returns the same category structure plus attribute schemas.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getDepartments()),
  });

  registerTool(server, {
    name: "walmart_get_inventory",
    description: "Get Walmart inventory for a single SKU.",
    annotations: READ_REMOTE,
    inputSchema: z.object({ sku: skuField, sellerProfileId: sellerProfileIdField }).strict(),
    outputSchema: passthroughShape,
    handler: async (input) => withClient(input.sellerProfileId, async (client) => client.getInventory(input.sku)),
  });

  registerTool(server, {
    name: "walmart_update_inventory",
    description: "Update Walmart inventory for a SKU. The payload should follow Walmart's inventory body shape.",
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
    description: "Update Walmart price for a SKU. The payload should follow Walmart's /v3/price body shape.",
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
