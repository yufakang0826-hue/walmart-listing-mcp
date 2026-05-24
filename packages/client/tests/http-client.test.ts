import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { WalmartHttpClient, WalmartClientError, __resetTokenCacheForTests } from "../src/http-client.js";

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

function makeClient(overrides?: { svcEnv?: string; clientId?: string; market?: "us" | "mx" | "ca" | "cl" }): WalmartHttpClient {
  return new WalmartHttpClient({
    sellerProfileId: `${overrides?.svcEnv ?? "prod"}-${overrides?.clientId ?? "client-id"}`,
    clientId: overrides?.clientId ?? "client-id",
    clientSecret: "client-secret",
    market: overrides?.market ?? "us",
    channelType: null,
    consumerId: null,
    svcEnv: overrides?.svcEnv ?? "prod",
  });
}

// Trigger a request without depending on any server-specific subclass method.
// All retry / token-cache / error-handling behavior runs through request().
async function triggerRequest(client: WalmartHttpClient): Promise<unknown> {
  return client.request({ method: "GET", path: "/v3/items" });
}

let fetchSpy: MockInstance<(...args: FetchArgs) => FetchReturn>;

beforeEach(() => {
  __resetTokenCacheForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as MockInstance<(...args: FetchArgs) => FetchReturn>;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WalmartHttpClient.verifyCredentials", () => {
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

  it("attaches WM_MARKET + WM_GLOBAL_VERSION on the token request", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    await makeClient({ market: "mx" }).verifyCredentials();
    const headers = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.WM_MARKET).toBe("mx");
    expect(headers?.WM_GLOBAL_VERSION).toBe("3.1");
  });
});

describe("WalmartHttpClient retry behavior", () => {
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

    await triggerRequest(makeClient());
    expect(tokenCalls).toBe(2);
    expect(itemCalls).toBe(3);
  });

  it("gives up after MAX_RETRIES on persistent 5xx", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse({ status: 503, body: { errors: [{ code: "BUSY" }] } }));
    });

    await expect(triggerRequest(makeClient())).rejects.toBeInstanceOf(WalmartClientError);
  }, 30_000);
});

describe("WalmartHttpClient token cache", () => {
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

    await triggerRequest(makeClient({ svcEnv: "prod" }));
    await triggerRequest(makeClient({ svcEnv: "stg" }));
    expect(tokenCalls).toBe(2);
  });

  it("scopes the cache per market so a us client does not reuse a mx token", async () => {
    let tokenCalls = 0;
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/v3/token")) {
        tokenCalls += 1;
        return Promise.resolve(tokenResponse(`tok-${tokenCalls}`));
      }
      return Promise.resolve(jsonResponse({ status: 200, body: { ItemResponse: [] } }));
    });

    await triggerRequest(makeClient({ market: "us" }));
    await triggerRequest(makeClient({ market: "mx" }));
    expect(tokenCalls).toBe(2);
  });
});
