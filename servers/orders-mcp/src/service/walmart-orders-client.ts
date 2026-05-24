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
  async getOrders(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/orders", params });
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

  // Ship order — POST /v3/orders/{purchaseOrderId}/shipping
  // Payload contains orderLines with trackingInfo (carrier, trackingNumber, methodCode).
  async shipOrder(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/shipping`,
      body: payload,
    });
  }

  // Cancel order — POST /v3/orders/{purchaseOrderId}/cancel
  async cancelOrder(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/cancel`,
      body: payload,
    });
  }

  // Refund order — POST /v3/orders/{purchaseOrderId}/refund
  async refundOrder(purchaseOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/orders/${encodeURIComponent(purchaseOrderId)}/refund`,
      body: payload,
    });
  }

  // List returns — GET /v3/returns
  async getReturns(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/returns", params });
  }

  // Issue return refund — POST /v3/returns/{returnOrderId}/refund
  async issueReturnRefund(returnOrderId: string, payload: unknown): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/v3/returns/${encodeURIComponent(returnOrderId)}/refund`,
      body: payload,
    });
  }
}
