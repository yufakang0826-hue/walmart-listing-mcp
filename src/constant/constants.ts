export const DEFAULT_MARKETPLACE = process.env.WALMART_MARKETPLACE || "US";
export const DEFAULT_SERVICE_NAME = process.env.WALMART_SERVICE_NAME || "Walmart Marketplace";
export const DEFAULT_PROFILE_STORE_FILENAME = ".walmart-seller-profiles.json";
export const MARKETPLACE_BASE_URL = "https://marketplace.walmartapis.com";
export const SANDBOX_BASE_URL = "https://sandbox.walmartapis.com";
export const TOKEN_PATH = "/v3/token";
export const MAX_RETRIES = 5;
export const BASE_DELAY_MS = 2_000;
export const TOKEN_SAFETY_WINDOW_MS = 60_000;

export function isSandboxEnvironment(): boolean {
  return process.env.WALMART_SANDBOX === "true";
}

export function getMarketplaceBaseUrl(): string {
  return isSandboxEnvironment() ? SANDBOX_BASE_URL : MARKETPLACE_BASE_URL;
}
