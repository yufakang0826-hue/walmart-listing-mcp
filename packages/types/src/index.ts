// @walmart-mcp/types — Walmart Global API shared types.

export type WalmartMarket = "us" | "mx" | "ca" | "cl";

export const WALMART_MARKETS: readonly WalmartMarket[] = ["us", "mx", "ca", "cl"] as const;

export const MARKET_CURRENCY: Readonly<Record<WalmartMarket, string>> = {
  us: "USD",
  mx: "MXN",
  ca: "CAD",
  cl: "CLP",
};

export const MARKET_LOCALES: Readonly<Record<WalmartMarket, readonly string[]>> = {
  us: ["en-US"],
  mx: ["es-MX"],
  ca: ["en-CA", "fr-CA"],
  cl: ["es-CL"],
};

export const WM_GLOBAL_VERSION = "3.1";
