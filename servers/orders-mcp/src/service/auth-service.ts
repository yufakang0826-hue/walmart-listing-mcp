import { isSandboxEnvironment } from "@walmart-mcp/client";
import { sellerProfileStore, type SellerProfileRecord } from "@walmart-mcp/profiles";
import { WALMART_MARKETS, type WalmartMarket } from "@walmart-mcp/types";
import { WalmartOrdersClient } from "./walmart-orders-client.js";

function isValidMarket(value: unknown): value is WalmartMarket {
  return typeof value === "string" && (WALMART_MARKETS as readonly string[]).includes(value);
}

function coerceMarket(raw: string | undefined, fallback: WalmartMarket = "us"): WalmartMarket {
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  return isValidMarket(lower) ? lower : fallback;
}

interface ResolvedCredentials {
  sellerProfileId: string | null;
  sellerProfileLabel: string | null;
  clientId: string;
  clientSecret: string;
  market: WalmartMarket;
  channelType: string | null;
  consumerId: string | null;
  svcEnv: string;
}

/**
 * Thin auth-service for orders-mcp. Reuses @walmart-mcp/profiles store —
 * same sellerProfile records as listing-mcp. A profile created via
 * listing-mcp's walmart_upsert_seller_profile is usable by orders-mcp
 * without re-entering credentials.
 */
class WalmartOrdersAuthService {
  private get envClientId(): string {
    return process.env.WALMART_CLIENT_ID || "";
  }

  private get envClientSecret(): string {
    return process.env.WALMART_CLIENT_SECRET || "";
  }

  private get envMarket(): WalmartMarket {
    const explicit = process.env.WALMART_MARKET;
    if (explicit) return coerceMarket(explicit);
    return coerceMarket(process.env.WALMART_MARKETPLACE);
  }

  private get envChannelType(): string {
    return process.env.WALMART_CHANNEL_TYPE || "";
  }

  private get envConsumerId(): string {
    return process.env.WALMART_CONSUMER_ID || "";
  }

  private get envSvcEnv(): string {
    return process.env.WALMART_SVC_ENV || (isSandboxEnvironment() ? "stg" : "prod");
  }

  private getSelectedProfileId(profileId?: string): string | undefined {
    return profileId || sellerProfileStore.getActiveProfileId();
  }

  private getSelectedProfile(profileId?: string): SellerProfileRecord | undefined {
    const selectedProfileId = this.getSelectedProfileId(profileId);
    return selectedProfileId ? sellerProfileStore.getProfile(selectedProfileId) : undefined;
  }

  getResolvedCredentials(profileId?: string): ResolvedCredentials {
    const profile = this.getSelectedProfile(profileId);
    const selectedProfileId = profile?.sellerProfileId || null;

    const clientId = profile?.clientId || this.envClientId;
    const clientSecret = profile?.clientSecret || this.envClientSecret;
    const market = profile?.market || this.envMarket;
    const channelType = profile?.channelType || this.envChannelType || null;
    const consumerId = profile?.consumerId || this.envConsumerId || null;
    const svcEnv = profile?.svcEnv || this.envSvcEnv;

    if (!clientId || !clientSecret) {
      if (selectedProfileId) {
        throw new Error(`Seller profile ${selectedProfileId} does not have both clientId and clientSecret configured.`);
      }
      throw new Error("WALMART_CLIENT_ID and WALMART_CLIENT_SECRET are required, or select a seller profile with credentials.");
    }

    return {
      sellerProfileId: selectedProfileId,
      sellerProfileLabel: profile?.sellerProfileLabel || null,
      clientId,
      clientSecret,
      market,
      channelType,
      consumerId,
      svcEnv,
    };
  }

  createClient(profileId?: string): WalmartOrdersClient {
    const credentials = this.getResolvedCredentials(profileId);
    return new WalmartOrdersClient({
      sellerProfileId: credentials.sellerProfileId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      market: credentials.market,
      channelType: credentials.channelType,
      consumerId: credentials.consumerId,
      svcEnv: credentials.svcEnv,
    });
  }

  getActiveMarket(profileId?: string): WalmartMarket {
    const profile = this.getSelectedProfile(profileId);
    return profile?.market || this.envMarket;
  }
}

export const authService = new WalmartOrdersAuthService();
