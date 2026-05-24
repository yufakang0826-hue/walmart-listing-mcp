import { randomUUID } from "node:crypto";
import { WM_GLOBAL_VERSION, type WalmartMarket } from "@walmart-mcp/types";
import {
  BASE_DELAY_MS,
  DEFAULT_SERVICE_NAME,
  MAX_BACKOFF_MS,
  MAX_RETRIES,
  TOKEN_PATH,
  TOKEN_SAFETY_WINDOW_MS,
  getMarketplaceBaseUrl,
  isSandboxEnvironment,
} from "./constants.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export type QueryParams = Record<string, string | number | boolean | undefined>;

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

export interface WalmartHttpClientConfig {
  sellerProfileId?: string | null;
  clientId: string;
  clientSecret: string;
  /**
   * Walmart Global API market. Sent as `WM_MARKET` header on every request
   * (including OAuth token call). Required since v1.0.0.
   */
  market: WalmartMarket;
  channelType?: string | null;
  consumerId?: string | null;
  svcEnv?: string | null;
}

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  params?: QueryParams;
  body?: unknown;
  accept?: string;
  contentType?: string;
  fileUpload?: {
    filename: string;
    mimeType: string;
  };
}

const tokenCache = new Map<string, WalmartTokenInfo>();

// Exposed for test isolation only; do not call from production code.
export function __resetTokenCacheForTests(): void {
  tokenCache.clear();
}

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
  const exponentialDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
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

function serializeBody(body: unknown, contentType: string): string {
  if (typeof body === "string") {
    return body;
  }
  if (contentType.includes("json")) {
    return JSON.stringify(body);
  }
  return String(body);
}

function buildRequestBody(options: RequestOptions): { body: BodyInit | undefined; headers: Record<string, string> } {
  if (options.body === undefined) {
    return { body: undefined, headers: {} };
  }

  if (options.fileUpload) {
    const { filename, mimeType } = options.fileUpload;
    const serialized = serializeBody(options.body, mimeType);
    const form = new FormData();
    form.append("file", new Blob([serialized], { type: mimeType }), filename);
    return { body: form, headers: {} };
  }

  const contentType = options.contentType || "application/json";
  return {
    body: serializeBody(options.body, contentType),
    headers: { "Content-Type": contentType },
  };
}

/**
 * Walmart Global Marketplace API HTTP client base.
 *
 * Provides OAuth (client_credentials at /v3/token), market-scoped token
 * cache, retry with jitter, rate-limit replenish backoff, and automatic
 * injection of WM_MARKET + WM_GLOBAL_VERSION + WM_SVC.NAME +
 * WM_QOS.CORRELATION_ID on every outbound request.
 *
 * Server-specific clients (listing / orders / fulfillment / reports / ads)
 * extend this class and add typed methods that call `this.request()`.
 *
 * Token cache key is `(svcEnv, market, profile-or-clientId)` — each
 * (market, account) pair gets its own bearer token.
 */
export class WalmartHttpClient {
  protected readonly sellerProfileId: string | null;
  protected readonly clientId: string;
  protected readonly clientSecret: string;
  protected readonly market: WalmartMarket;
  protected readonly channelType: string | null;
  protected readonly consumerId: string | null;
  protected readonly svcEnv: string;

  constructor(config: WalmartHttpClientConfig) {
    this.sellerProfileId = config.sellerProfileId || null;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.market = config.market;
    this.channelType = config.channelType || null;
    this.consumerId = config.consumerId || null;
    this.svcEnv = config.svcEnv || "prod";
  }

  private get partnerHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "WM_SVC.ENV": this.svcEnv };
    if (this.channelType) {
      headers["WM_CONSUMER.CHANNEL.TYPE"] = this.channelType;
    }
    if (this.consumerId) {
      headers["WM_CONSUMER.ID"] = this.consumerId;
    }
    return headers;
  }

  private get cacheKey(): string {
    // Tokens are scoped per (svcEnv, market, clientId/profile). Each market needs
    // its own token even when the underlying clientId is the same.
    const scope = `${this.svcEnv}:${this.market}`;
    return this.sellerProfileId ? `${scope}:${this.sellerProfileId}` : `${scope}:${this.clientId}`;
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
        // Global API requires WM_MARKET on the token call itself per docs:
        // https://developer.walmart.com/mx-marketplace/reference/tokenapi
        "WM_MARKET": this.market,
        "WM_GLOBAL_VERSION": WM_GLOBAL_VERSION,
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

  /**
   * Make an authenticated request to the Walmart Global Marketplace API.
   *
   * Server-specific subclasses (WalmartListingClient, future WalmartOrdersClient,
   * etc.) call this with typed args from their domain methods. Handles:
   * - automatic OAuth token fetch + refresh on 401 (one retry)
   * - 429 Retry-After-style backoff using x-next-replenish-time header
   * - 5xx exponential backoff + jitter, up to MAX_RETRIES
   * - multipart/form-data for fileUpload payloads (feed submissions)
   * - text vs JSON response decoding based on Content-Type
   */
  async request<T = unknown>(options: RequestOptions): Promise<T> {
    let lastError: unknown;
    let hasRefreshedToken = false;
    let forceRefreshOnce = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const token = await this.getAccessToken(forceRefreshOnce);
        forceRefreshOnce = false;
        const { body: fetchBody, headers: bodyHeaders } = buildRequestBody(options);
        const response = await fetch(this.buildUrl(options.path, options.params), {
          method: options.method,
          headers: {
            "WM_SEC.ACCESS_TOKEN": token,
            "WM_SVC.NAME": DEFAULT_SERVICE_NAME,
            "WM_QOS.CORRELATION_ID": randomUUID(),
            "WM_MARKET": this.market,
            "WM_GLOBAL_VERSION": WM_GLOBAL_VERSION,
            ...this.partnerHeaders,
            Accept: options.accept || "application/json",
            ...bodyHeaders,
          },
          body: fetchBody,
        });

        if (!response.ok) {
          const responseText = await response.text();
          let parsedBody: unknown = responseText;
          try {
            parsedBody = responseText ? JSON.parse(responseText) : {};
          } catch {
            parsedBody = responseText;
          }

          if (response.status === 401 && !hasRefreshedToken) {
            hasRefreshedToken = true;
            forceRefreshOnce = true;
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

  getContext(): { sellerProfileId: string | null; market: WalmartMarket; sandbox: boolean } {
    return {
      sellerProfileId: this.sellerProfileId,
      market: this.market,
      sandbox: isSandboxEnvironment(),
    };
  }
}
