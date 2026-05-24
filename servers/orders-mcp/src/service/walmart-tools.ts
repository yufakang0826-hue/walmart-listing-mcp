import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { serializeError, serializeSuccess } from "@walmart-mcp/client";
import { authService } from "./auth-service.js";
import type { WalmartOrdersClient } from "./walmart-orders-client.js";

type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

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
    (async (input: z.infer<TInput>) => {
      try {
        return serializeSuccess(await def.handler(input), source) as CallToolResult;
      } catch (error) {
        return serializeError(error) as CallToolResult;
      }
    }) as Parameters<typeof server.registerTool>[2],
  );
}

// Annotation presets — mirror the listing-mcp set.
const READ_REMOTE: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

const WRITE_REMOTE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_REMOTE_NONIDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const sellerProfileIdField = z
  .string()
  .optional()
  .describe("Optional seller profile ID. If omitted, the active profile is used.");

const purchaseOrderIdField = z
  .string()
  .describe("Walmart purchase order ID (the PO# from the order detail page).");

const passthroughShape = z.object({}).passthrough();

async function withClient<T>(
  profileId: string | undefined,
  fn: (client: WalmartOrdersClient) => Promise<T>,
): Promise<T> {
  const client = authService.createClient(profileId);
  return fn(client);
}

export async function registerWalmartOrdersTools(server: McpServer): Promise<void> {
  registerTool(server, {
    name: "walmart_get_orders",
    description:
      "List Walmart orders for the active seller profile. Filter by createdStartDate / status / shipNodeType / productInfo via params. Returns a paginated list with nextCursor for follow-up calls. Multi-market via WM_MARKET on the active profile.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        createdStartDate: z.string().optional().describe("ISO 8601 datetime — only orders created at/after this time."),
        createdEndDate: z.string().optional().describe("ISO 8601 datetime — only orders created at/before this time."),
        status: z.string().optional().describe("Order status filter (e.g. Created, Acknowledged, Shipped, Cancelled, Delivered, Refunded)."),
        limit: z.number().int().positive().max(200).optional().describe("Max orders per page (Walmart caps at 200)."),
        nextCursor: z.string().optional().describe("Pagination cursor from a previous response."),
        purchaseOrderId: z.string().optional().describe("Filter to a single PO# (use walmart_get_order for full detail)."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getOrders({
          createdStartDate: input.createdStartDate,
          createdEndDate: input.createdEndDate,
          status: input.status,
          limit: input.limit,
          nextCursor: input.nextCursor,
          purchaseOrderId: input.purchaseOrderId,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_order",
    description:
      "Get full detail for a single Walmart order by purchase order ID — line items, shipping address, customer, currentStatus, payment method, fulfillment center.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.getOrder(input.purchaseOrderId)),
  });

  registerTool(server, {
    name: "walmart_acknowledge_order",
    description:
      "Acknowledge receipt of a Walmart order. MUST be done within 4 hours of order creation — Walmart penalizes late acks on the seller scorecard. Idempotent (re-acking is a no-op).",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.acknowledgeOrder(input.purchaseOrderId)),
  });

  registerTool(server, {
    name: "walmart_ship_order",
    description:
      "Mark a Walmart order shipped with carrier + tracking. Payload follows Walmart's orderShipment shape — orderLines[].orderLineShipment with shipDateTime, carrierName, trackingNumber, trackingURL, methodCode. Per-line shipping supported (split shipments).",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Walmart shipping payload. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.shipOrder(input.purchaseOrderId, input.payload)),
  });

  registerTool(server, {
    name: "walmart_cancel_order",
    description:
      "Cancel one or more lines on a Walmart order. Payload selects lineNumbers + cancellationReason. Excessive cancellations hurt the seller scorecard — prefer fulfilling when possible.",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Cancel request body with orderLines + cancellationReason. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.cancelOrder(input.purchaseOrderId, input.payload)),
  });

  registerTool(server, {
    name: "walmart_refund_order",
    description:
      "Issue a refund on a Walmart order line. Payload selects orderLines + refundReason + amount. For return-driven refunds, prefer walmart_issue_return_refund.",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Refund request body. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.refundOrder(input.purchaseOrderId, input.payload)),
  });

  registerTool(server, {
    name: "walmart_get_returns",
    description:
      "List Walmart return orders for the active seller profile. Filter by returnCreationDate / status / customerOrderId via params.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        returnCreationStartDate: z.string().optional().describe("ISO 8601 — only returns created at/after."),
        returnCreationEndDate: z.string().optional().describe("ISO 8601 — only returns created at/before."),
        status: z.string().optional().describe("Return status filter (INITIATED, RECEIVED, COMPLETED, etc.)."),
        customerOrderId: z.string().optional().describe("Filter by customer order ID."),
        limit: z.number().int().positive().max(200).optional(),
        nextCursor: z.string().optional(),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.getReturns({
          returnCreationStartDate: input.returnCreationStartDate,
          returnCreationEndDate: input.returnCreationEndDate,
          status: input.status,
          customerOrderId: input.customerOrderId,
          limit: input.limit,
          nextCursor: input.nextCursor,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_issue_return_refund",
    description:
      "Refund a specific Walmart return order. Payload follows Walmart's return-refund shape — returnLines with refundAmount + refundType. Refunds beyond Walmart's max-refund-amount are auto-rejected.",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        returnOrderId: z.string().describe("Walmart return order ID (different from purchaseOrderId)."),
        payload: z.record(z.unknown()).describe("Return refund payload. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.issueReturnRefund(input.returnOrderId, input.payload),
      ),
  });
}
