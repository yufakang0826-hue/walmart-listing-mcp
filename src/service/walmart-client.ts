import { randomUUID } from "node:crypto";
import {
  BASE_DELAY_MS,
  DEFAULT_SERVICE_NAME,
  MAX_RETRIES,
  TOKEN_PATH,
  TOKEN_SAFETY_WINDOW_MS,
  getMarketplaceBaseUrl,
  isSandboxEnvironment,
} from "../constant/constants.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type QueryParams = Record<string, string | number | boolean | undefined>;

export interface WalmartTokenInfo {
  accessToken: string;
  expiresIn: number;
  expiresAt: number;
  tokenType: string;
}

export class WalmartClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "WalmartClientError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

interface WalmartClientConfig {
  sellerProfileId?: string | null;
  clientId: string;
  clientSecret: string;
  marketplace: string;
}

interface RequestOptions {
  method: HttpMethod;
  path: string;
  params?: QueryParams;
  body?: unknown;
  accept?: string;
  contentType?: string;
}

const tokenCache = new Map<string, WalmartTokenInfo>();

function buildErrorMessage(body: unknown, fallback: string): { code: string; message: string } {
  if (body && typeof body === "object") {
    const errors = (body as { errors?: Array<{ code?: string; description?: string; message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      return {
        code: first?.code ? `WALMART_${first.code}` : "WALMART_API_ERROR",
        message: first?.description || first?.message || fallback,
      };
    }
  }

  if (typeof body === "string" && body.trim()) {
    return {
      code: "WALMART_API_ERROR",
      message: body.slice(0, 500),
    };
  }

  return {
    code: "WALMART_API_ERROR",
    message: fallback,
  };
}

function computeBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay * 0.5;
  return exponentialDelay + jitter;
}

function getReplenishTime(headers: Headers): number | null {
  const replenish = headers.get("x-next-replenish-time");
  if (!replenish) {
    return null;
  }

  const parsed = Number.parseInt(replenish, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WalmartClient {
  private readonly sellerProfileId: string | null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly marketplace: string;

  constructor(config: WalmartClientConfig) {
    this.sellerProfileId = config.sellerProfileId || null;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.marketplace = config.marketplace;
  }

  private get cacheKey(): string {
    return this.sellerProfileId || `${this.marketplace}:${this.clientId}`;
  }

  private get marketplaceBaseUrl(): string {
    return getMarketplaceBaseUrl();
  }

  async verifyCredentials(): Promise<Omit<WalmartTokenInfo, "accessToken">> {
    const token = await this.fetchAccessToken(true);
    return {
      expiresIn: token.expiresIn,
      expiresAt: token.expiresAt,
      tokenType: token.tokenType,
    };
  }

  private async fetchAccessToken(forceRefresh = false): Promise<WalmartTokenInfo> {
    const cached = tokenCache.get(this.cacheKey);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt - TOKEN_SAFETY_WINDOW_MS) {
      return cached;
    }

    const response = await fetch(`${this.marketplaceBaseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "WM_SVC.NAME": DEFAULT_SERVICE_NAME,
        "WM_QOS.CORRELATION_ID": randomUUID(),
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });

    const responseText = await response.text();
    let parsed: unknown = responseText;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch {
      parsed = responseText;
    }

    if (!response.ok) {
      const error = buildErrorMessage(parsed, `Walmart token request failed with status ${response.status}`);
      throw new WalmartClientError(response.status >= 500 ? 502 : response.status, error.code, error.message, parsed);
    }

    const payload = parsed as { access_token?: string; expires_in?: number; token_type?: string };
    if (!payload.access_token || !payload.expires_in) {
      throw new WalmartClientError(502, "WALMART_AUTH_ERROR", "Walmart token response is missing access_token or expires_in", parsed);
    }

    const tokenInfo: WalmartTokenInfo = {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
      expiresAt: Date.now() + payload.expires_in * 1_000,
      tokenType: payload.token_type || "Bearer",
    };
    tokenCache.set(this.cacheKey, tokenInfo);
    return tokenInfo;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    return (await this.fetchAccessToken(forceRefresh)).accessToken;
  }

  private buildUrl(path: string, params?: QueryParams): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.marketplaceBaseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url;
  }

  private async request<T = unknown>(options: RequestOptions): Promise<T> {
    let lastError: unknown;
    let didRefreshToken = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const token = await this.getAccessToken(didRefreshToken);
        const response = await fetch(this.buildUrl(options.path, options.params), {
          method: options.method,
          headers: {
            "WM_SEC.ACCESS_TOKEN": token,
            "WM_SVC.NAME": DEFAULT_SERVICE_NAME,
            "WM_QOS.CORRELATION_ID": randomUUID(),
            Accept: options.accept || "application/json",
            ...(options.body !== undefined ? { "Content-Type": options.contentType || "application/json" } : {}),
          },
          body: options.body !== undefined
            ? (options.contentType || "application/json") === "application/json"
              ? JSON.stringify(options.body)
              : String(options.body)
            : undefined,
        });

        if (!response.ok) {
          const responseText = await response.text();
          let parsedBody: unknown = responseText;
          try {
            parsedBody = responseText ? JSON.parse(responseText) : {};
          } catch {
            parsedBody = responseText;
          }

          if (response.status === 401 && !didRefreshToken) {
            didRefreshToken = true;
            tokenCache.delete(this.cacheKey);
            continue;
          }

          if (response.status === 429 && attempt < MAX_RETRIES) {
            await sleep(getReplenishTime(response.headers) ?? computeBackoffDelay(attempt));
            continue;
          }

          if (response.status >= 500 && attempt < MAX_RETRIES) {
            await sleep(computeBackoffDelay(attempt));
            continue;
          }

          const error = buildErrorMessage(parsedBody, `${options.method} ${options.path} failed with status ${response.status}`);
          throw new WalmartClientError(response.status >= 500 ? 502 : response.status, error.code, error.message, parsedBody);
        }

        if (response.status === 204) {
          return null as T;
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return (await response.json()) as T;
        }

        return (await response.text()) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof WalmartClientError) {
          throw error;
        }
        if (attempt < MAX_RETRIES) {
          await sleep(computeBackoffDelay(attempt));
          continue;
        }
      }
    }

    throw new WalmartClientError(502, "WALMART_NETWORK_ERROR", `Walmart request failed: ${String(lastError)}`, lastError);
  }

  async invokeMarketplaceApi(method: HttpMethod, path: string, params?: QueryParams, body?: unknown, contentType?: string, accept?: string): Promise<unknown> {
    return this.request({ method, path, params, body, contentType, accept });
  }

  async getItems(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/items", params });
  }

  async getItem(sku: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/v3/items/${encodeURIComponent(sku)}` });
  }

  async retireItem(sku: string): Promise<unknown> {
    return this.request({ method: "DELETE", path: `/v3/items/${encodeURIComponent(sku)}` });
  }

  async getItemStatus(sku: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/v3/items/${encodeURIComponent(sku)}/status` });
  }

  async submitFeed(feedType: string, payload: unknown, params?: QueryParams): Promise<unknown> {
    return this.request({
      method: "POST",
      path: "/v3/feeds",
      params: { feedType, ...(params || {}) },
      body: payload,
    });
  }

  async getTaxonomy(feedType = "MP_ITEM", version = "5.0"): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/utilities/taxonomy", params: { feedType, version } });
  }

  async getDepartments(): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/utilities/taxonomy/departments" });
  }

  async getFeedStatus(feedId: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/v3/feeds/${encodeURIComponent(feedId)}`, params: { includeDetails: true } });
  }

  async getFeeds(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/feeds", params });
  }

  async getInventory(sku: string): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/inventory", params: { sku } });
  }

  async updateInventory(sku: string, payload: unknown): Promise<unknown> {
    return this.request({ method: "PUT", path: "/v3/inventory", params: { sku }, body: payload });
  }

  async getBulkInventory(params?: QueryParams): Promise<unknown> {
    return this.request({ method: "GET", path: "/v3/inventory", params });
  }

  async updatePrice(payload: unknown): Promise<unknown> {
    return this.request({ method: "PUT", path: "/v3/price", body: payload });
  }

  getContext(): { sellerProfileId: string | null; marketplace: string; sandbox: boolean } {
    return {
      sellerProfileId: this.sellerProfileId,
      marketplace: this.marketplace,
      sandbox: isSandboxEnvironment(),
    };
  }
}
