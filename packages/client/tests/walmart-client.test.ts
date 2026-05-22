import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { WalmartClient, WalmartClientError, __resetTokenCacheForTests } from "../src/walmart-client.js";

type FetchArgs = Parameters<typeof fetch>;
type FetchReturn = ReturnType<typeof fetch>;

interface ResponseSpec {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function jsonResponse(spec: ResponseSpec): Response {
  const text = typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
  return new Response(text, {
    status: spec.status,
    headers: { "content-type": "application/json", ...(spec.headers || {}) },
  });
}

function tokenResponse(token = "tok-1"): Response {
  return jsonResponse({
    status: 200,
    body: { access_token: token, expires_in: 900, token_type: "Bearer" },
  });
}

function makeClient(overrides?: { svcEnv?: string; clientId?: string }): WalmartClient {
  return new WalmartClient({
    sellerProfileId: `${overrides?.svcEnv ?? "prod"}-${overrides?.clientId ?? "client-id"}`,
    clientId: overrides?.clientId ?? "client-id",
    clientSecret: "client-secret",
    marketplace: "US",
    channelType: null,
    consumerId: null,
    svcEnv: overrides?.svcEnv ?? "prod",
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

describe("WalmartClient.verifyCredentials", () => {
  it("fetches a token and returns expiry metadata", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());

    const result = await makeClient().verifyCredentials();
    expect(result.tokenType).toBe("Bearer");
    expect(result.expiresIn).toBe(900);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    expect(String(call?.[0])).toContain("/v3/token");
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization?.startsWith("Basic ")).toBe(true);
  });

  it("surfaces token errors with a Walmart-prefixed code", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      status: 401,
      body: { errors: [{ code: "INVALID_CREDENTIALS", description: "bad creds" }] },
    }));

    await expect(makeClient().verifyCredentials()).rejects.toMatchObject({
      name: "WalmartClientError",
      code: "WALMART_INVALID_CREDENTIALS",
      message: "bad creds",
    });
  });
});

describe("WalmartClient retry behavior", () => {
  it("refreshes the token exactly once on 401, then continues without re-refreshing on later retries", async () => {
    let tokenCalls = 0;
    let itemCalls = 0;
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) {
        tokenCalls += 1;
        return Promise.resolve(tokenResponse(`tok-${tokenCalls}`));
      }
      itemCalls += 1;
      if (itemCalls === 1) return Promise.resolve(jsonResponse({ status: 401, body: { errors: [{ code: "EXPIRED" }] } }));
      if (itemCalls === 2) return Promise.resolve(jsonResponse({ status: 429, body: {}, headers: { "x-next-replenish-time": "1" } }));
      return Promise.resolve(jsonResponse({ status: 200, body: { ItemResponse: [] } }));
    });

    await makeClient().getItems();
    expect(tokenCalls).toBe(2);
    expect(itemCalls).toBe(3);
  });

  it("gives up after MAX_RETRIES on persistent 5xx", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse({ status: 503, body: { errors: [{ code: "BUSY" }] } }));
    });

    await expect(makeClient().getItems()).rejects.toBeInstanceOf(WalmartClientError);
  }, 30_000);
});

describe("WalmartClient.getItemStatus", () => {
  it("throws 404 when no item matches the requested SKU", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse({
        status: 200,
        body: { ItemResponse: [{ sku: "OTHER", publishedStatus: "PUBLISHED" }] },
      }));
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
      return Promise.resolve(jsonResponse({
        status: 200,
        body: {
          ItemResponse: [{ sku: "WANTED", publishedStatus: "PUBLISHED", lifecycleStatus: "ACTIVE", wpid: "wpid-1" }],
        },
      }));
    });

    const status = await makeClient().getItemStatus("WANTED") as {
      sku: string;
      wpid: string | null;
      publishedStatus: string | null;
    };
    expect(status.sku).toBe("WANTED");
    expect(status.publishedStatus).toBe("PUBLISHED");
    expect(status.wpid).toBe("wpid-1");
  });
});

describe("WalmartClient token cache", () => {
  it("scopes the cache so a sandbox client does not reuse a prod token", async () => {
    let tokenCalls = 0;
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) {
        tokenCalls += 1;
        return Promise.resolve(tokenResponse(`tok-${tokenCalls}`));
      }
      return Promise.resolve(jsonResponse({ status: 200, body: { ItemResponse: [] } }));
    });

    await makeClient({ svcEnv: "prod" }).getItems();
    await makeClient({ svcEnv: "stg" }).getItems();
    expect(tokenCalls).toBe(2);
  });
});
