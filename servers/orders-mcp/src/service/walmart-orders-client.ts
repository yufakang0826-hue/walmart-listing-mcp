import { WalmartHttpClient, type QueryParams } from "@walmart-mcp/client";

/**
 * Walmart Orders + Returns API client.
 *
 * Wraps the seller-side order lifecycle endpoints (list / get / acknowledge /
 * ship / cancel / refund) and returns endpoints under the Walmart Global
 * Marketplace API. Extends @walmart-mcp/client WalmartHttpClient — inherits
 * OAuth, market routing (WM_MARKET), retry, and rate-limit handling.
 *
 * Method bodies are filled in once endpoint paths are verified against
 * walmart official docs (probe-first per CLAUDE.md). Stubs throw until
 * implementation lands.
 */
export class WalmartOrdersClient extends WalmartHttpClient {
  // List orders — GET /v3/orders with optional filters
  async listOrders(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/orders", params });
  }

  // List released orders (ready to ship) — GET /v3/orders/released
  // Same query-param set as listOrders.
  async listReleasedOrders(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/orders/released", params });
  }

  // Get single order — GET /v3/orders/{purchaseOrderId}
  async getOrder(purchaseOrderId: string): Promise<unknown> {
    return this.request({
      method: "GET",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}`,
    });
  }

  // Acknowledge order — POST /v3/orders/{purchaseOrderId}/acknowledge
  // Must be done within 4h of order creation per Walmart SLA.
  async acknowledgeOrder(purchaseOrderId: string): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/acknowledge`,
    });
  }

  // Ship order lines — POST /v3/orders/{purchaseOrderId}/shipping
  // Payload contains orderShipment.orderLines with trackingInfo
  // (carrier, trackingNumber, trackingURL, methodCode, shipDateTime).
  async shipOrderLines(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/shipping`,
      body: payload,
    });
  }

  // Cancel order lines — POST /v3/orders/{purchaseOrderId}/cancel
  // Only lines in Acknowledged status are cancellable per Walmart docs.
  async cancelOrderLines(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/cancel`,
      body: payload,
    });
  }

  // Refund order lines (pre-return refund) — POST /v3/orders/{purchaseOrderId}/refund
  // For return-driven refunds use issueReturnRefund instead.
  async refundOrderLines(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/refund`,
      body: payload,
    });
  }

  // List returns — GET /v3/returns
  async listReturns(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/returns", params });
  }

  // Get a single return — uses the list endpoint with returnOrderId query filter.
  // Walmart does NOT expose GET /v3/returns/{returnOrderId} as a single-resource
  // path (verified absent from the API reference index 2026-05-25).
  async getReturn(returnOrderId: string): Promise<unknown> {
    return this.request({
      method: "GET",
      path: "/v3/returns",
      params: { returnOrderId },
    });
  }

  // Issue return refund — POST /v3/returns/{returnOrderId}/refund
  // Body: { customerOrderId, refundLines: [{ returnOrderLineNumber, quantity: { unitOfMeasure, measurementValue } }] }
  async issueReturnRefund(returnOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/returns/${encodeURIComponent(returnOrderId)}/refund`,
      body: payload,
    });
  }
}
