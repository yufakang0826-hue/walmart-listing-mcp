import { WalmartClient, isSandboxEnvironment } from "@walmart-mcp/client";
import { sellerProfileStore, type SellerProfileRecord } from "@walmart-mcp/profiles";
import { WALMART_MARKETS, type WalmartMarket } from "@walmart-mcp/types";

function isValidMarket(value: unknown): value is WalmartMarket {
  return typeof value === "string" && (WALMART_MARKETS as readonly string[]).includes(value);
}

function coerceMarket(raw: string | undefined, fallback: WalmartMarket = "us"): WalmartMarket {
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  return isValidMarket(lower) ? lower : fallback;
}

interface UpsertSellerProfileOptions {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  market?: WalmartMarket;
  clientId?: string;
  clientSecret?: string;
  channelType?: string;
  consumerId?: string;
  svcEnv?: string;
  setActive?: boolean;
}

interface SellerProfileSummary {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  market: WalmartMarket;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasChannelType: boolean;
  hasConsumerId: boolean;
  svcEnv: string;
  isActive: boolean;
  updatedAt: string;
}

interface TokenStatus {
  authenticated: boolean;
  hasClientCredentials: boolean;
  usingSellerProfileStore: boolean;
  sellerProfileId: string | null;
  sellerProfileLabel: string | null;
  activeSellerProfileId: string | null;
  market: WalmartMarket;
  sandbox: boolean;
  availableSellerProfiles: SellerProfileSummary[];
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

class WalmartAuthService {
  private get envClientId(): string {
    return process.env.WALMART_CLIENT_ID || "";
  }

  private get envClientSecret(): string {
    return process.env.WALMART_CLIENT_SECRET || "";
  }

  private get envMarket(): WalmartMarket {
    // v1.0.0 prefers WALMART_MARKET (lowercase). Falls back to legacy
    // WALMART_MARKETPLACE for backward compat with v0.x .env files.
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

  private toSummary(profile: SellerProfileRecord): SellerProfileSummary {
    const activeId = sellerProfileStore.getActiveProfileId();
    return {
      sellerProfileId: profile.sellerProfileId,
      sellerProfileLabel: profile.sellerProfileLabel,
      market: profile.market,
      hasClientId: Boolean(profile.clientId),
      hasClientSecret: Boolean(profile.clientSecret),
      hasChannelType: Boolean(profile.channelType || this.envChannelType),
      hasConsumerId: Boolean(profile.consumerId || this.envConsumerId),
      svcEnv: profile.svcEnv || this.envSvcEnv,
      isActive: profile.sellerProfileId === activeId,
      updatedAt: profile.updatedAt,
    };
  }

  listSellerProfiles(): SellerProfileSummary[] {
    return sellerProfileStore.listProfiles().map((profile) => this.toSummary(profile));
  }

  setActiveSellerProfile(profileId: string): SellerProfileSummary {
    return this.toSummary(sellerProfileStore.setActiveProfile(profileId));
  }

  upsertSellerProfile(options: UpsertSellerProfileOptions): SellerProfileSummary {
    const current = sellerProfileStore.getProfile(options.sellerProfileId);
    const market = options.market || current?.market || this.envMarket;
    const profile = sellerProfileStore.upsertProfile(options.sellerProfileId, {
      sellerProfileLabel: options.sellerProfileLabel,
      market,
      clientId: options.clientId || current?.clientId,
      clientSecret: options.clientSecret || current?.clientSecret,
      channelType: options.channelType || current?.channelType,
      consumerId: options.consumerId || current?.consumerId,
      svcEnv: options.svcEnv || current?.svcEnv,
    });

    if (options.setActive ?? true) {
      sellerProfileStore.setActiveProfile(options.sellerProfileId);
    }

    return this.toSummary(profile);
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

  createClient(profileId?: string): WalmartClient {
    const credentials = this.getResolvedCredentials(profileId);
    return new WalmartClient({
      sellerProfileId: credentials.sellerProfileId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      market: credentials.market,
      channelType: credentials.channelType,
      consumerId: credentials.consumerId,
      svcEnv: credentials.svcEnv,
    });
  }

  async verifyCredentials(profileId?: string): Promise<{
    sellerProfileId: string | null;
    market: WalmartMarket;
    sandbox: boolean;
    expiresIn: number;
    expiresAt: string;
    tokenType: string;
  }> {
    const credentials = this.getResolvedCredentials(profileId);
    const verification = await this.createClient(profileId).verifyCredentials();
    return {
      sellerProfileId: credentials.sellerProfileId,
      market: credentials.market,
      sandbox: isSandboxEnvironment(),
      expiresIn: verification.expiresIn,
      expiresAt: new Date(verification.expiresAt).toISOString(),
      tokenType: verification.tokenType,
    };
  }

  getTokenStatus(profileId?: string): TokenStatus {
    const safe = this.getResolvedCredentialsSafe(profileId);
    return {
      authenticated: safe.hasClientCredentials,
      hasClientCredentials: safe.hasClientCredentials,
      usingSellerProfileStore: Boolean(safe.sellerProfileId),
      sellerProfileId: safe.sellerProfileId,
      sellerProfileLabel: safe.sellerProfileLabel,
      activeSellerProfileId: sellerProfileStore.getActiveProfileId() || null,
      market: safe.market,
      sandbox: isSandboxEnvironment(),
      availableSellerProfiles: this.listSellerProfiles(),
    };
  }

  /**
   * Resolve the active market without throwing — used by market-guard checks
   * in walmart-tools.ts to decide whether US-only endpoints should be called.
   */
  getActiveMarket(profileId?: string): WalmartMarket {
    const profile = this.getSelectedProfile(profileId);
    return profile?.market || this.envMarket;
  }

  private getResolvedCredentialsSafe(profileId?: string): {
    sellerProfileId: string | null;
    sellerProfileLabel: string | null;
    market: WalmartMarket;
    hasClientCredentials: boolean;
  } {
    const profile = this.getSelectedProfile(profileId);
    const clientId = profile?.clientId || this.envClientId;
    const clientSecret = profile?.clientSecret || this.envClientSecret;

    return {
      sellerProfileId: profile?.sellerProfileId || null,
      sellerProfileLabel: profile?.sellerProfileLabel || null,
      market: profile?.market || this.envMarket,
      hasClientCredentials: Boolean(clientId && clientSecret),
    };
  }
}

export const authService = new WalmartAuthService();
