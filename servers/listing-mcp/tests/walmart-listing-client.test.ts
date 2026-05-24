import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { __resetTokenCacheForTests } from "@walmart-mcp/client";
import { WalmartListingClient } from "../src/service/walmart-listing-client.js";

type FetchArgs = Parameters<typeof fetch>;
type FetchReturn = ReturnType<typeof fetch>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse(200, { access_token: "tok-1", expires_in: 900, token_type: "Bearer" });
}

function makeClient(): WalmartListingClient {
  return new WalmartListingClient({
    sellerProfileId: "test-profile",
    clientId: "client-id",
    clientSecret: "client-secret",
    market: "us",
    channelType: null,
    consumerId: null,
    svcEnv: "prod",
  });
}

let fetchSpy: MockInstance<(...args: FetchArgs) => FetchReturn>;

beforeEach(() => {
  __resetTokenCacheForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as MockInstance<(...args: FetchArgs) => FetchReturn>;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WalmartListingClient.getItemStatus", () => {
  it("throws 404 when no item matches the requested SKU", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse(200, { ItemResponse: [{ sku: "OTHER", publishedStatus: "PUBLISHED" }] }));
    });

    await expect(makeClient().getItemStatus("WANTED")).rejects.toMatchObject({
      code: "WALMART_ITEM_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("returns derived status when SKU matches", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse(200, {
        ItemResponse: [{ sku: "WANTED", publishedStatus: "PUBLISHED", lifecycleStatus: "ACTIVE", wpid: "wpid-1" }],
      }));
    });

    const status = (await makeClient().getItemStatus("WANTED")) as {
      sku: string;
      wpid: string | null;
      publishedStatus: string | null;
    };
    expect(status.sku).toBe("WANTED");
    expect(status.publishedStatus).toBe("PUBLISHED");
    expect(status.wpid).toBe("wpid-1");
  });
});

describe("WalmartListingClient inheritance smoke", () => {
  it("inherits verifyCredentials from WalmartHttpClient", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    const result = await makeClient().verifyCredentials();
    expect(result.tokenType).toBe("Bearer");
  });

  it("inherits market routing — token call carries WM_MARKET=us", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    await makeClient().verifyCredentials();
    const headers = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.WM_MARKET).toBe("us");
    expect(headers?.WM_GLOBAL_VERSION).toBe("3.1");
  });
});
