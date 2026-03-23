import { DEFAULT_MARKETPLACE, isSandboxEnvironment } from "../constant/constants.js";
import { sellerProfileStore, type SellerProfileRecord } from "./seller-profile-store.js";
import { WalmartClient } from "./walmart-client.js";

interface UpsertSellerProfileOptions {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  marketplace?: string;
  clientId?: string;
  clientSecret?: string;
  setActive?: boolean;
}

interface SellerProfileSummary {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  marketplace: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
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
  marketplace: string;
  sandbox: boolean;
  availableSellerProfiles: SellerProfileSummary[];
}

interface ResolvedCredentials {
  sellerProfileId: string | null;
  sellerProfileLabel: string | null;
  clientId: string;
  clientSecret: string;
  marketplace: string;
}

class WalmartAuthService {
  private get envClientId(): string {
    return process.env.WALMART_CLIENT_ID || "";
  }

  private get envClientSecret(): string {
    return process.env.WALMART_CLIENT_SECRET || "";
  }

  private get envMarketplace(): string {
    return process.env.WALMART_MARKETPLACE || DEFAULT_MARKETPLACE;
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
      marketplace: profile.marketplace,
      hasClientId: Boolean(profile.clientId),
      hasClientSecret: Boolean(profile.clientSecret),
      isActive: profile.sellerProfileId === activeId,
      updatedAt: profile.updatedAt,
    };
  }

  getStartupErrors(): string[] {
    // Allow the MCP server to start without credentials so auth/profile tools remain usable.
    // Listing calls will still fail at tool execution time until credentials are configured.
    return [];
  }

  listSellerProfiles(): SellerProfileSummary[] {
    return sellerProfileStore.listProfiles().map((profile) => this.toSummary(profile));
  }

  setActiveSellerProfile(profileId: string): SellerProfileSummary {
    return this.toSummary(sellerProfileStore.setActiveProfile(profileId));
  }

  upsertSellerProfile(options: UpsertSellerProfileOptions): SellerProfileSummary {
    const current = sellerProfileStore.getProfile(options.sellerProfileId);
    const profile = sellerProfileStore.upsertProfile(options.sellerProfileId, {
      sellerProfileLabel: options.sellerProfileLabel,
      marketplace: options.marketplace || current?.marketplace || this.envMarketplace,
      clientId: options.clientId || current?.clientId,
      clientSecret: options.clientSecret || current?.clientSecret,
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
    const marketplace = profile?.marketplace || this.envMarketplace;

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
      marketplace,
    };
  }

  createClient(profileId?: string): WalmartClient {
    const credentials = this.getResolvedCredentials(profileId);
    return new WalmartClient({
      sellerProfileId: credentials.sellerProfileId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      marketplace: credentials.marketplace,
    });
  }

  async verifyCredentials(profileId?: string): Promise<{
    sellerProfileId: string | null;
    marketplace: string;
    sandbox: boolean;
    expiresIn: number;
    expiresAt: string;
    tokenType: string;
  }> {
    const credentials = this.getResolvedCredentials(profileId);
    const verification = await this.createClient(profileId).verifyCredentials();
    return {
      sellerProfileId: credentials.sellerProfileId,
      marketplace: credentials.marketplace,
      sandbox: isSandboxEnvironment(),
      expiresIn: verification.expiresIn,
      expiresAt: new Date(verification.expiresAt).toISOString(),
      tokenType: verification.tokenType,
    };
  }

  getTokenStatus(profileId?: string): TokenStatus {
    const credentials = this.getResolvedCredentialsSafe(profileId);
    return {
      authenticated: credentials.hasClientCredentials,
      hasClientCredentials: credentials.hasClientCredentials,
      usingSellerProfileStore: Boolean(credentials.sellerProfileId),
      sellerProfileId: credentials.sellerProfileId,
      sellerProfileLabel: credentials.sellerProfileLabel,
      activeSellerProfileId: sellerProfileStore.getActiveProfileId() || null,
      marketplace: credentials.marketplace,
      sandbox: isSandboxEnvironment(),
      availableSellerProfiles: this.listSellerProfiles(),
    };
  }

  private getResolvedCredentialsSafe(profileId?: string): {
    sellerProfileId: string | null;
    sellerProfileLabel: string | null;
    marketplace: string;
    hasClientCredentials: boolean;
  } {
    const profile = this.getSelectedProfile(profileId);
    const clientId = profile?.clientId || this.envClientId;
    const clientSecret = profile?.clientSecret || this.envClientSecret;

    return {
      sellerProfileId: profile?.sellerProfileId || null,
      sellerProfileLabel: profile?.sellerProfileLabel || null,
      marketplace: profile?.marketplace || this.envMarketplace,
      hasClientCredentials: Boolean(clientId && clientSecret),
    };
  }
}

export const authService = new WalmartAuthService();
