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

const methodSchema = z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const paramsSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

export const listingPathPrefixes = [
  "/v3/items",
  "/v3/inventory",
  "/v3/price",
  "/v3/feeds",
  "/v3/utilities/taxonomy",
];

export function assertListingPathAllowed(path: string): void {
  const rawPath = path.startsWith("/") ? path : `/${path}`;
  // Reject any encoded or literal traversal segment / backslash escape so URL
  // normalization cannot turn /v3/items/../orders into /v3/orders.
  if (rawPath.includes("..") || /%2e/i.test(rawPath) || rawPath.includes("\\") || /%5c/i.test(rawPath)) {
    throw new Error(`Path contains disallowed traversal or escape sequence: ${rawPath}`);
  }
  const queryIdx = rawPath.search(/[?#]/);
  const pathSegment = queryIdx >= 0 ? rawPath.slice(0, queryIdx) : rawPath;
  const isAllowed = listingPathPrefixes.some((prefix) => pathSegment.startsWith(prefix));
  if (!isAllowed) {
    throw new Error(`Path is outside the listing-only scope: ${pathSegment}`);
  }
}

function registerTool<TInput extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: TInput,
  outputSchema: z.ZodObject<z.ZodRawShape>,
  handler: (input: z.infer<TInput>) => Promise<unknown>,
  annotations: ToolAnnotations,
): void {
  // Tell serializeSuccess whether the payload originated outside our trust
  // boundary so it can wrap text content with the untrusted-input warning.
  const source = annotations.openWorldHint ? "external" : "local";

  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema,
      annotations,
    },
    (async (input: z.infer<TInput>) => {
      try {
        return serializeSuccess(await handler(input), source) as CallToolResult;
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
// behavior hints at a glance.
const READ_LOCAL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const READ_REMOTE: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
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
    sellerProfileId: z.string().nullable().optional(),
    hasCredentials: z.boolean().optional(),
    isCached: z.boolean().optional(),
    expiresAt: z.union([z.string(), z.number()]).nullable().optional(),
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

export async function registerWalmartTools(server: McpServer): Promise<void> {
  registerAuthTools(server);
  registerListingTools(server);
}

function registerAuthTools(server: McpServer): void {
  registerTool(
    server,
    "walmart_upsert_seller_profile",
    "Create or update a Walmart seller profile. Stores clientId, clientSecret, marketplace, channelType, consumerId, and svcEnv locally.",
    z
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
    sellerProfileShape,
    async (input) =>
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
    WRITE_LOCAL,
  );

  registerTool(
    server,
    "walmart_list_seller_profiles",
    "List locally stored Walmart seller profiles and indicate which one is active.",
    z.object({}).strict(),
    z
      .object({
        sellerProfiles: z.array(sellerProfileShape),
      })
      .passthrough(),
    async () => ({ sellerProfiles: authService.listSellerProfiles() }),
    READ_LOCAL,
  );

  registerTool(
    server,
    "walmart_set_active_seller_profile",
    "Set the active Walmart seller profile used by listing tools when sellerProfileId is omitted.",
    z
      .object({
        sellerProfileId: z.string().describe("Seller profile ID to activate."),
      })
      .strict(),
    z
      .object({
        success: z.boolean(),
        activeSellerProfile: sellerProfileShape,
      })
      .passthrough(),
    async (input) => ({
      success: true,
      activeSellerProfile: authService.setActiveSellerProfile(input.sellerProfileId),
    }),
    WRITE_LOCAL,
  );

  registerTool(
    server,
    "walmart_get_token_status",
    "Show the current Walmart authentication status used by this MCP server.",
    z
      .object({
        sellerProfileId: z.string().optional().describe("Optional seller profile ID. If omitted, the active profile is used first."),
      })
      .strict(),
    tokenStatusShape,
    async (input) => authService.getTokenStatus(input.sellerProfileId),
    READ_LOCAL,
  );

  registerTool(
    server,
    "walmart_verify_credentials",
    "Verify that the configured Walmart clientId and clientSecret can fetch an access token.",
    z
      .object({
        sellerProfileId: z.string().optional().describe("Optional seller profile ID. If omitted, the active profile is used first."),
      })
      .strict(),
    z
      .object({
        ok: z.boolean().optional(),
        success: z.boolean().optional(),
      })
      .passthrough(),
    async (input) => authService.verifyCredentials(input.sellerProfileId),
    READ_REMOTE,
  );
}

function registerListingTools(server: McpServer): void {
  registerTool(
    server,
    "walmart_invoke_listing_api",
    "Invoke a Walmart listing-related Marketplace API directly. Restricted to /v3/items, /v3/inventory, /v3/price, /v3/feeds, /v3/utilities/taxonomy. Path traversal (.. or %2e) is blocked. Supported methods: GET, POST, PUT, DELETE, PATCH.",
    z
      .object({
        method: methodSchema.describe("HTTP method."),
        path: z.string().describe("Marketplace API path such as /v3/items, /v3/feeds, or /v3/inventory."),
        params: paramsSchema.describe("Optional query parameters."),
        body: z.any().optional().describe("Optional request body."),
        contentType: z.string().optional().describe("Optional Content-Type header. Defaults to application/json."),
        accept: z.string().optional().describe("Optional Accept header. Defaults to application/json."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) => {
        assertListingPathAllowed(input.path);
        return client.invokeMarketplaceApi(
          input.method,
          input.path,
          input.params,
          input.body,
          input.contentType,
          input.accept,
        );
      }),
    // Worst-case: caller can issue any HTTP method against any allowed path,
    // including destructive deletes. Hint conservatively.
    WRITE_REMOTE_NONIDEMPOTENT,
  );

  registerTool(
    server,
    "walmart_get_items",
    "List Walmart items for the active seller profile.",
    z
      .object({
        limit: z.number().optional().describe("Optional page size."),
        offset: z.number().optional().describe("Optional offset."),
        sku: z.string().optional().describe("Optional SKU filter."),
        lifecycleStatus: z.string().optional().describe("Optional lifecycle status filter."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    walmartItemListShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getItems({
          limit: input.limit,
          offset: input.offset,
          sku: input.sku,
          lifecycleStatus: input.lifecycleStatus,
        }),
      ),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_item",
    "Get a single Walmart item by SKU.",
    z
      .object({
        sku: z.string().describe("Seller SKU."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) => withClient(input.sellerProfileId, async (client) => client.getItem(input.sku)),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_item_status",
    "Get Walmart item status fields by SKU using the item lookup response.",
    z
      .object({
        sku: z.string().describe("Seller SKU."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    z
      .object({
        sku: z.string().optional(),
        publishedStatus: z.string().optional(),
        lifecycleStatus: z.string().optional(),
        availability: z.string().optional(),
      })
      .passthrough(),
    async (input) => withClient(input.sellerProfileId, async (client) => client.getItemStatus(input.sku)),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_retire_item",
    "Retire or delist a Walmart item by SKU.",
    z
      .object({
        sku: z.string().describe("Seller SKU."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    successShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) => ({
        success: true,
        result: await client.retireItem(input.sku),
      })),
    WRITE_REMOTE_IDEMPOTENT,
  );

  registerTool(
    server,
    "walmart_submit_feed",
    "Submit a Walmart feed for listing operations. Payload is uploaded as multipart/form-data (Walmart API requirement). Common feedType values include MP_ITEM and price.",
    z
      .object({
        feedType: z.string().describe("Feed type, for example MP_ITEM or price."),
        payload: z.any().describe("Exact Walmart feed payload body (object for JSON, string for XML)."),
        params: paramsSchema.describe("Optional extra query parameters such as feedVersion or locale."),
        contentType: z.string().optional().describe("Optional feed content type. Defaults to application/json, set to application/xml for XML feeds, application/zip for bulk feeds."),
        filename: z.string().optional().describe("Optional filename for the multipart upload. Defaults to feed.json/feed.xml/feed.zip based on contentType."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    walmartFeedSubmitShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) => {
        const feedOptions: { contentType?: string; filename?: string } = {};
        if (typeof input.contentType === "string") feedOptions.contentType = input.contentType;
        if (typeof input.filename === "string") feedOptions.filename = input.filename;
        return client.submitFeed(
          input.feedType,
          input.payload,
          input.params,
          Object.keys(feedOptions).length > 0 ? feedOptions : undefined,
        );
      }),
    // Each submission creates a new feed with a new feedId — not idempotent.
    WRITE_REMOTE_NONIDEMPOTENT,
  );

  registerTool(
    server,
    "walmart_get_feed_status",
    "Get Walmart feed processing status by feed ID.",
    z
      .object({
        feedId: z.string().describe("Feed ID returned by Walmart."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    walmartFeedStatusShape,
    async (input) => withClient(input.sellerProfileId, async (client) => client.getFeedStatus(input.feedId)),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_feeds",
    "List Walmart feeds for the active seller profile.",
    z
      .object({
        feedType: z.string().optional().describe("Optional feed type filter."),
        limit: z.number().optional().describe("Optional page size."),
        offset: z.number().optional().describe("Optional offset."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    z
      .object({
        results: z
          .object({
            feed: z.array(walmartFeedStatusShape).optional(),
          })
          .passthrough()
          .optional(),
        totalResults: z.number().optional(),
      })
      .passthrough(),
    async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getFeeds({
          feedType: input.feedType,
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_taxonomy",
    "Get Walmart taxonomy data for listing category work.",
    z
      .object({
        feedType: z.string().optional().describe("Feed type, defaults to MP_ITEM."),
        version: z.string().optional().describe("Taxonomy version, defaults to 5.0."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) => client.getTaxonomy(input.feedType, input.version)),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_departments",
    "Get Walmart departments used for listing taxonomy navigation.",
    z
      .object({
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) => withClient(input.sellerProfileId, async (client) => client.getDepartments()),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_inventory",
    "Get Walmart inventory for a single SKU.",
    z
      .object({
        sku: z.string().describe("Seller SKU."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) => withClient(input.sellerProfileId, async (client) => client.getInventory(input.sku)),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_get_bulk_inventory",
    "List Walmart inventory records.",
    z
      .object({
        limit: z.number().optional().describe("Optional page size."),
        offset: z.number().optional().describe("Optional offset."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getBulkInventory({
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    READ_REMOTE,
  );

  registerTool(
    server,
    "walmart_update_inventory",
    "Update Walmart inventory for a SKU. The payload should follow Walmart's inventory body shape.",
    z
      .object({
        sku: z.string().describe("Seller SKU."),
        payload: z.any().describe("Inventory request body."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) =>
      withClient(input.sellerProfileId, async (client) => client.updateInventory(input.sku, input.payload)),
    WRITE_REMOTE_IDEMPOTENT,
  );

  registerTool(
    server,
    "walmart_update_price",
    "Update Walmart price for a SKU. The payload should follow Walmart's /v3/price body shape.",
    z
      .object({
        payload: z.any().describe("Price request body."),
        sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
      })
      .strict(),
    passthroughShape,
    async (input) => withClient(input.sellerProfileId, async (client) => client.updatePrice(input.payload)),
    WRITE_REMOTE_IDEMPOTENT,
  );
}
