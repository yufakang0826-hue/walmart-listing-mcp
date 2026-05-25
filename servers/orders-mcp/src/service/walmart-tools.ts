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
    name: "walmart_list_orders",
    description:
      "List Walmart orders for the active seller profile (GET /v3/orders). Filter by createdStartDate/EndDate, status, sku, purchaseOrderId, customerOrderId, shipNodeType, lastModifiedStartDate/EndDate. Walmart caps response at 200 orders per call; use list.meta.nextCursor for pagination. Status vocabulary: Created, Acknowledged, Shipped, Cancelled, Delivered, Refunded. 180-day max lookback. Multi-market via WM_MARKET on the active profile.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        createdStartDate: z.string().optional().describe("ISO 8601 datetime — only orders created at/after this time."),
        createdEndDate: z.string().optional().describe("ISO 8601 datetime — only orders created at/before this time."),
        lastModifiedStartDate: z.string().optional().describe("ISO 8601 — filter by last-modified."),
        lastModifiedEndDate: z.string().optional().describe("ISO 8601 — filter by last-modified."),
        status: z.string().optional().describe("Order status filter (Created | Acknowledged | Shipped | Cancelled | Delivered | Refunded)."),
        sku: z.string().optional().describe("Filter to orders containing this seller SKU."),
        customerOrderId: z.string().optional().describe("Filter by Walmart customer order ID."),
        purchaseOrderId: z.string().optional().describe("Filter to a single PO# (use walmart_get_order for full detail)."),
        shipNodeType: z.string().optional().describe("SellerFulfilled (default) | WFSFulfilled."),
        limit: z.number().int().positive().max(200).optional().describe("Max orders per page (default 100, max 200)."),
        productInfo: z.boolean().optional().describe("Include extended product info in response (default false)."),
        nextCursor: z.string().optional().describe("Pagination cursor from a previous response's list.meta.nextCursor."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.listOrders({
          createdStartDate: input.createdStartDate,
          createdEndDate: input.createdEndDate,
          lastModifiedStartDate: input.lastModifiedStartDate,
          lastModifiedEndDate: input.lastModifiedEndDate,
          status: input.status,
          sku: input.sku,
          customerOrderId: input.customerOrderId,
          purchaseOrderId: input.purchaseOrderId,
          shipNodeType: input.shipNodeType,
          limit: input.limit,
          productInfo: input.productInfo,
          nextCursor: input.nextCursor,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_list_released_orders",
    description:
      "List orders Walmart has released to you for fulfillment (GET /v3/orders/released). Subset of walmart_list_orders narrowed to ready-to-ship orders. Same query params as walmart_list_orders.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        createdStartDate: z.string().optional(),
        createdEndDate: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
        nextCursor: z.string().optional(),
        productInfo: z.boolean().optional(),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.listReleasedOrders({
          createdStartDate: input.createdStartDate,
          createdEndDate: input.createdEndDate,
          limit: input.limit,
          nextCursor: input.nextCursor,
          productInfo: input.productInfo,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_order",
    description:
      "Get full detail for a single Walmart order by purchase order ID (GET /v3/orders/{purchaseOrderId}). Returns line items, shipping address, customer info, currentStatus per line, charges with currency, fulfillment center, estimated delivery date.",
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
      "Acknowledge receipt of a Walmart order (POST /v3/orders/{purchaseOrderId}/acknowledge). MUST be done within 4 hours of order creation per Walmart SLA — late acks return 200 but count against your Seller Performance scorecard. No partial acknowledgement (Walmart-confirmed). Idempotent — re-ack is safe. Empty body.",
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
    name: "walmart_acknowledge_orders_bulk",
    description:
      "Composite tool — acknowledge multiple Walmart orders in parallel. Walmart has NO native bulk-ack endpoint (verified absent from API reference); this tool loops over per-PO acknowledgeOrder with Promise.allSettled. Partial failures do NOT fail the call; per-PO result is reported. Use when sweeping a backlog of unacknowledged orders.",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderIds: z.array(z.string()).min(1).max(50).describe("Array of purchase order IDs to ack (max 50 per call to avoid rate-limit pressure)."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: z
      .object({
        results: z.array(z.object({
          purchaseOrderId: z.string(),
          ok: z.boolean(),
          response: z.unknown().optional(),
          error: z.string().optional(),
        })),
        succeeded: z.number(),
        failed: z.number(),
      })
      .passthrough(),
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => {
        const settled = await Promise.allSettled(
          input.purchaseOrderIds.map((po) => client.acknowledgeOrder(po)),
        );
        const results = settled.map((r, i) => {
          const purchaseOrderId = input.purchaseOrderIds[i] ?? "";
          if (r.status === "fulfilled") return { purchaseOrderId, ok: true, response: r.value };
          return { purchaseOrderId, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
        });
        const succeeded = results.filter((r) => r.ok).length;
        return { results, succeeded, failed: results.length - succeeded };
      }),
  });

  registerTool(server, {
    name: "walmart_ship_order_lines",
    description:
      "Mark Walmart order line(s) shipped with carrier + tracking (POST /v3/orders/{purchaseOrderId}/shipping). Payload follows Walmart's orderShipment.orderLines schema with trackingInfo per line (carrierName, trackingNumber, trackingURL, methodCode, shipDateTime). Supports per-line shipping (split shipments). Re-posting with updated tracking is the documented way to update tracking — Walmart has no separate update-tracking endpoint. Carrier names are locale-influenced (US prefers USPS/FedEx/UPS; CA accepts Canada Post; MX accepts Estafeta).",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Walmart shipping payload. Top-level shape: { orderShipment: { orderLines: { orderLine: [...] } } }. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.shipOrderLines(input.purchaseOrderId, input.payload),
      ),
  });

  registerTool(server, {
    name: "walmart_cancel_order_lines",
    description:
      "Cancel one or more lines on a Walmart order (POST /v3/orders/{purchaseOrderId}/cancel). Only lines in Acknowledged status are cancellable. Excessive cancellations hurt your Seller Performance scorecard — prefer fulfilling when possible. Payload selects orderLines + cancellationReason per line.",
    annotations: WRITE_REMOTE_IDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Cancel request body with orderLines + cancellationReason. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.cancelOrderLines(input.purchaseOrderId, input.payload),
      ),
  });

  registerTool(server, {
    name: "walmart_refund_order_lines",
    description:
      "Issue a refund on Walmart order line(s) (POST /v3/orders/{purchaseOrderId}/refund). Pre-return refund flow — for refunds tied to a return order use walmart_issue_return_refund. Each call creates a new refund record (non-idempotent). Currency in the payload must match the order's market currency.",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        purchaseOrderId: purchaseOrderIdField,
        payload: z.record(z.unknown()).describe("Refund request body with orderLines + refundCharges. Required."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.refundOrderLines(input.purchaseOrderId, input.payload),
      ),
  });

  registerTool(server, {
    name: "walmart_list_returns",
    description:
      "List Walmart return orders for the active seller profile (GET /v3/returns). Filter by returnCreationStartDate/EndDate, status (INITIATED | RECEIVED | COMPLETED), customerOrderId, returnType. Use returnOrderId param for single-return lookup (walmart_get_return wraps that). Multi-market via WM_MARKET.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        returnCreationStartDate: z.string().optional().describe("ISO 8601 — only returns created at/after."),
        returnCreationEndDate: z.string().optional().describe("ISO 8601 — only returns created at/before."),
        status: z.string().optional().describe("Return status filter."),
        customerOrderId: z.string().optional().describe("Filter by customer order ID."),
        returnType: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
        nextCursor: z.string().optional(),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) =>
        client.listReturns({
          returnCreationStartDate: input.returnCreationStartDate,
          returnCreationEndDate: input.returnCreationEndDate,
          status: input.status,
          customerOrderId: input.customerOrderId,
          returnType: input.returnType,
          limit: input.limit,
          nextCursor: input.nextCursor,
        }),
      ),
  });

  registerTool(server, {
    name: "walmart_get_return",
    description:
      "Get a single Walmart return order by returnOrderId. Wraps `GET /v3/returns?returnOrderId=...` — Walmart does NOT expose a single-resource `/v3/returns/{id}` path (verified absent from API reference). Returns the same shape as walmart_list_returns but typically with one element.",
    annotations: READ_REMOTE,
    inputSchema: z
      .object({
        returnOrderId: z.string().describe("Walmart return order ID (different from purchaseOrderId)."),
        sellerProfileId: sellerProfileIdField,
      })
      .strict(),
    outputSchema: passthroughShape,
    handler: async (input) =>
      withClient(input.sellerProfileId, async (client) => client.getReturn(input.returnOrderId)),
  });

  registerTool(server, {
    name: "walmart_issue_return_refund",
    description:
      "Refund a specific Walmart return order (POST /v3/returns/{returnOrderId}/refund). Payload: { customerOrderId, refundLines: [{ returnOrderLineNumber, quantity: { unitOfMeasure, measurementValue } }] }. Refunds beyond Walmart's max-refund-amount are auto-rejected. Each call creates a new refund record (non-idempotent). For pre-return refunds (no return order created), use walmart_refund_order_lines on the original PO.",
    annotations: WRITE_REMOTE_NONIDEMPOTENT,
    inputSchema: z
      .object({
        returnOrderId: z.string().describe("Walmart return order ID."),
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
