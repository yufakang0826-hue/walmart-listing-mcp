import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serializeError, serializeSuccess } from "../helper/format.js";
import { authService } from "./auth-service.js";

const methodSchema = z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const paramsSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

const listingPathPrefixes = [
  "/v3/items",
  "/v3/inventory",
  "/v3/price",
  "/v3/feeds",
  "/v3/utilities/taxonomy",
];

function assertListingPathAllowed(path: string): void {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isAllowed = listingPathPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
  if (!isAllowed) {
    throw new Error(`Path is outside the listing-only scope: ${normalizedPath}`);
  }
}

function registerTool(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
): void {
  server.tool(name, description, inputSchema, async (input) => {
    try {
      return serializeSuccess(await handler(input));
    } catch (error) {
      return serializeError(error);
    }
  });
}

async function withClient(
  input: Record<string, unknown>,
  handler: (client: ReturnType<typeof authService.createClient>) => Promise<unknown>,
): Promise<unknown> {
  const sellerProfileId = typeof input.sellerProfileId === "string" ? input.sellerProfileId : undefined;
  const client = authService.createClient(sellerProfileId);
  return handler(client);
}

export async function registerWalmartTools(server: McpServer): Promise<void> {
  registerAuthTools(server);
  registerListingTools(server);
}

function registerAuthTools(server: McpServer): void {
  registerTool(
    server,
    "walmart_upsert_seller_profile",
    "Create or update a Walmart seller profile for listing operations. Stores clientId, clientSecret, and marketplace locally.",
    {
      sellerProfileId: z.string().describe("Seller profile ID, for example walmart-us-main."),
      sellerProfileLabel: z.string().optional().describe("Optional human-readable label for the seller profile."),
      marketplace: z.string().optional().describe("Marketplace code such as US, CA, or MX."),
      clientId: z.string().optional().describe("Optional Walmart client ID."),
      clientSecret: z.string().optional().describe("Optional Walmart client secret."),
      setActive: z.boolean().default(true).describe("Whether to make this profile active immediately."),
    },
    async (input) => authService.upsertSellerProfile({
      sellerProfileId: String(input.sellerProfileId),
      sellerProfileLabel: typeof input.sellerProfileLabel === "string" ? input.sellerProfileLabel : undefined,
      marketplace: typeof input.marketplace === "string" ? input.marketplace : undefined,
      clientId: typeof input.clientId === "string" ? input.clientId : undefined,
      clientSecret: typeof input.clientSecret === "string" ? input.clientSecret : undefined,
      setActive: typeof input.setActive === "boolean" ? input.setActive : true,
    }),
  );

  registerTool(
    server,
    "walmart_list_seller_profiles",
    "List locally stored Walmart seller profiles and indicate which one is active.",
    {},
    async () => ({ sellerProfiles: authService.listSellerProfiles() }),
  );

  registerTool(
    server,
    "walmart_set_active_seller_profile",
    "Set the active Walmart seller profile used by listing tools when sellerProfileId is omitted.",
    {
      sellerProfileId: z.string().describe("Seller profile ID to activate."),
    },
    async (input) => ({
      success: true,
      activeSellerProfile: authService.setActiveSellerProfile(String(input.sellerProfileId)),
    }),
  );

  registerTool(
    server,
    "walmart_get_token_status",
    "Show the current Walmart authentication status used by this MCP server.",
    {
      sellerProfileId: z.string().optional().describe("Optional seller profile ID. If omitted, the active profile is used first."),
    },
    async (input) => authService.getTokenStatus(typeof input.sellerProfileId === "string" ? input.sellerProfileId : undefined),
  );

  registerTool(
    server,
    "walmart_verify_credentials",
    "Verify that the configured Walmart clientId and clientSecret can fetch an access token.",
    {
      sellerProfileId: z.string().optional().describe("Optional seller profile ID. If omitted, the active profile is used first."),
    },
    async (input) => authService.verifyCredentials(typeof input.sellerProfileId === "string" ? input.sellerProfileId : undefined),
  );
}

function registerListingTools(server: McpServer): void {
  registerTool(
    server,
    "walmart_invoke_listing_api",
    "Invoke a Walmart listing-related Marketplace API directly. Restricted to items, inventory, price, feeds, and taxonomy endpoints.",
    {
      method: methodSchema.describe("HTTP method."),
      path: z.string().describe("Marketplace API path such as /v3/items, /v3/feeds, or /v3/inventory."),
      params: paramsSchema.describe("Optional query parameters."),
      body: z.any().optional().describe("Optional request body."),
      contentType: z.string().optional().describe("Optional Content-Type header. Defaults to application/json."),
      accept: z.string().optional().describe("Optional Accept header. Defaults to application/json."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => {
      const path = String(input.path);
      assertListingPathAllowed(path);
      return client.invokeMarketplaceApi(
        input.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        path,
        input.params as Record<string, string | number | boolean | undefined> | undefined,
        input.body,
        typeof input.contentType === "string" ? input.contentType : undefined,
        typeof input.accept === "string" ? input.accept : undefined,
      );
    }),
  );

  registerTool(
    server,
    "walmart_get_items",
    "List Walmart items for the active seller profile.",
    {
      limit: z.number().optional().describe("Optional page size."),
      offset: z.number().optional().describe("Optional offset."),
      sku: z.string().optional().describe("Optional SKU filter."),
      lifecycleStatus: z.string().optional().describe("Optional lifecycle status filter."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getItems({
      limit: input.limit as number | undefined,
      offset: input.offset as number | undefined,
      sku: input.sku as string | undefined,
      lifecycleStatus: input.lifecycleStatus as string | undefined,
    })),
  );

  registerTool(
    server,
    "walmart_get_item",
    "Get a single Walmart item by SKU.",
    {
      sku: z.string().describe("Seller SKU."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getItem(String(input.sku))),
  );

  registerTool(
    server,
    "walmart_get_item_status",
    "Get Walmart item status fields by SKU using the item lookup response.",
    {
      sku: z.string().describe("Seller SKU."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getItemStatus(String(input.sku))),
  );

  registerTool(
    server,
    "walmart_retire_item",
    "Retire or delist a Walmart item by SKU.",
    {
      sku: z.string().describe("Seller SKU."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => ({
      success: true,
      result: await client.retireItem(String(input.sku)),
    })),
  );

  registerTool(
    server,
    "walmart_submit_feed",
    "Submit a Walmart feed for listing operations. Common feedType values include MP_ITEM and price.",
    {
      feedType: z.string().describe("Feed type, for example MP_ITEM or price."),
      payload: z.any().describe("Exact Walmart feed payload body."),
      params: paramsSchema.describe("Optional extra query parameters such as feedVersion or locale."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.submitFeed(
      String(input.feedType),
      input.payload,
      input.params as Record<string, string | number | boolean | undefined> | undefined,
    )),
  );

  registerTool(
    server,
    "walmart_get_feed_status",
    "Get Walmart feed processing status by feed ID.",
    {
      feedId: z.string().describe("Feed ID returned by Walmart."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getFeedStatus(String(input.feedId))),
  );

  registerTool(
    server,
    "walmart_get_feeds",
    "List Walmart feeds for the active seller profile.",
    {
      feedType: z.string().optional().describe("Optional feed type filter."),
      limit: z.number().optional().describe("Optional page size."),
      offset: z.number().optional().describe("Optional offset."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getFeeds({
      feedType: input.feedType as string | undefined,
      limit: input.limit as number | undefined,
      offset: input.offset as number | undefined,
    })),
  );

  registerTool(
    server,
    "walmart_get_taxonomy",
    "Get Walmart taxonomy data for listing category work.",
    {
      feedType: z.string().optional().describe("Feed type, defaults to MP_ITEM."),
      version: z.string().optional().describe("Taxonomy version, defaults to 5.0."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getTaxonomy(
      typeof input.feedType === "string" ? input.feedType : undefined,
      typeof input.version === "string" ? input.version : undefined,
    )),
  );

  registerTool(
    server,
    "walmart_get_departments",
    "Get Walmart departments used for listing taxonomy navigation.",
    {
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getDepartments()),
  );

  registerTool(
    server,
    "walmart_get_inventory",
    "Get Walmart inventory for a single SKU.",
    {
      sku: z.string().describe("Seller SKU."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getInventory(String(input.sku))),
  );

  registerTool(
    server,
    "walmart_get_bulk_inventory",
    "List Walmart inventory records.",
    {
      limit: z.number().optional().describe("Optional page size."),
      offset: z.number().optional().describe("Optional offset."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.getBulkInventory({
      limit: input.limit as number | undefined,
      offset: input.offset as number | undefined,
    })),
  );

  registerTool(
    server,
    "walmart_update_inventory",
    "Update Walmart inventory for a SKU. The payload should follow Walmart's inventory body shape.",
    {
      sku: z.string().describe("Seller SKU."),
      payload: z.any().describe("Inventory request body."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.updateInventory(String(input.sku), input.payload)),
  );

  registerTool(
    server,
    "walmart_update_price",
    "Update Walmart price for a SKU. The payload should follow Walmart's /v3/price body shape.",
    {
      payload: z.any().describe("Price request body."),
      sellerProfileId: z.string().optional().describe("Optional seller profile ID."),
    },
    async (input) => withClient(input, async (client) => client.updatePrice(input.payload)),
  );
}
