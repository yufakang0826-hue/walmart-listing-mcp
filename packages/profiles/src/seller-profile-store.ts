import * as fs from "node:fs";
import * as path from "node:path";
import { WALMART_MARKETS, type WalmartMarket } from "@walmart-mcp/types";

const DEFAULT_PROFILE_STORE_FILENAME = ".walmart-seller-profiles.json";

export interface SellerProfileRecord {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  /**
   * Walmart Global Marketplace market routing. Required in v1.0.0+.
   * Sent as `WM_MARKET` header on every API call.
   * Each (market, clientId) pair gets a separate OAuth token cache entry.
   */
  market: WalmartMarket;
  clientId?: string;
  clientSecret?: string;
  channelType?: string;
  consumerId?: string;
  svcEnv?: string;
  updatedAt: string;
}

interface SellerProfileStoreData {
  activeSellerProfileId?: string;
  profiles: Record<string, SellerProfileRecord>;
}

interface LegacySellerProfileRecord extends Omit<SellerProfileRecord, "market"> {
  market?: WalmartMarket;
  marketplace?: string;
}

function createEmptyStore(): SellerProfileStoreData {
  return { profiles: {} };
}

function isValidMarket(value: unknown): value is WalmartMarket {
  return typeof value === "string" && (WALMART_MARKETS as readonly string[]).includes(value);
}

/**
 * Migrate a pre-v1.0.0 profile record that lacks the `market` field.
 * Legacy profiles only spoke to US Marketplace, so we default to `us`.
 * The `marketplace` string field (e.g. "US") is dropped.
 */
function migrateLegacyRecord(raw: LegacySellerProfileRecord): SellerProfileRecord {
  let market: WalmartMarket;
  if (isValidMarket(raw.market)) {
    market = raw.market;
  } else if (typeof raw.marketplace === "string") {
    const lower = raw.marketplace.toLowerCase();
    market = isValidMarket(lower) ? lower : "us";
  } else {
    market = "us";
  }

  const { marketplace: _legacyMarketplace, ...rest } = raw;
  return { ...rest, market };
}

class SellerProfileStore {
  private cache: SellerProfileStoreData | null = null;
  private cachedPath: string | null = null;

  private get storePath(): string {
    return process.env.WALMART_SELLER_PROFILE_STORE || path.join(process.cwd(), DEFAULT_PROFILE_STORE_FILENAME);
  }

  private readStore(): SellerProfileStoreData {
    const currentPath = this.storePath;
    if (this.cache && this.cachedPath === currentPath) {
      return this.cache;
    }

    let data: SellerProfileStoreData;
    if (!fs.existsSync(currentPath)) {
      data = createEmptyStore();
    } else {
      const content = fs.readFileSync(currentPath, "utf-8").trim();
      if (!content) {
        data = createEmptyStore();
      } else {
        const parsed = JSON.parse(content) as Partial<{
          activeSellerProfileId: string;
          profiles: Record<string, LegacySellerProfileRecord>;
        }>;
        const rawProfiles = parsed.profiles || {};
        const migrated: Record<string, SellerProfileRecord> = {};
        for (const [id, raw] of Object.entries(rawProfiles)) {
          migrated[id] = migrateLegacyRecord(raw);
        }
        data = {
          activeSellerProfileId: parsed.activeSellerProfileId,
          profiles: migrated,
        };
      }
    }

    this.cache = data;
    this.cachedPath = currentPath;
    return data;
  }

  private writeStore(store: SellerProfileStoreData): void {
    const currentPath = this.storePath;
    fs.mkdirSync(path.dirname(currentPath), { recursive: true });

    const serialized = `${JSON.stringify(store, null, 2)}\n`;
    const tempPath = `${currentPath}.${process.pid}.${Date.now()}.tmp`;

    // mode 0o600 only effective on POSIX; on Windows the ACL is inherited.
    fs.writeFileSync(tempPath, serialized, { encoding: "utf-8", mode: 0o600 });
    try {
      fs.renameSync(tempPath, currentPath);
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch { /* swallow cleanup errors */ }
      throw error;
    }

    try {
      fs.chmodSync(currentPath, 0o600);
    } catch {
      // chmod is a best-effort tightening on POSIX; Windows ignores it.
    }

    this.cache = store;
    this.cachedPath = currentPath;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cachedPath = null;
  }

  listProfiles(): SellerProfileRecord[] {
    return Object.values(this.readStore().profiles).sort((left, right) => left.sellerProfileId.localeCompare(right.sellerProfileId));
  }

  hasProfiles(): boolean {
    return this.listProfiles().length > 0;
  }

  getProfile(profileId: string): SellerProfileRecord | undefined {
    return this.readStore().profiles[profileId];
  }

  getActiveProfileId(): string | undefined {
    return this.readStore().activeSellerProfileId;
  }

  setActiveProfile(profileId: string): SellerProfileRecord {
    const store = this.readStore();
    const profile = store.profiles[profileId];
    if (!profile) {
      throw new Error(`Seller profile not found: ${profileId}`);
    }

    const next: SellerProfileStoreData = {
      ...store,
      activeSellerProfileId: profileId,
    };
    this.writeStore(next);
    return profile;
  }

  upsertProfile(profileId: string, updates: Partial<SellerProfileRecord>): SellerProfileRecord {
    const store = this.readStore();
    const current = store.profiles[profileId];
    const market = updates.market ?? current?.market;
    if (!market) {
      throw new Error(`market is required when creating seller profile ${profileId} (one of: ${WALMART_MARKETS.join(", ")})`);
    }
    if (!isValidMarket(market)) {
      throw new Error(`Invalid market "${market}" for profile ${profileId}; must be one of: ${WALMART_MARKETS.join(", ")}`);
    }

    const nextProfile: SellerProfileRecord = {
      ...(current || {}),
      ...updates,
      sellerProfileId: profileId,
      market,
      updatedAt: new Date().toISOString(),
    };

    const nextStore: SellerProfileStoreData = {
      activeSellerProfileId: store.activeSellerProfileId || profileId,
      profiles: { ...store.profiles, [profileId]: nextProfile },
    };
    this.writeStore(nextStore);
    return nextProfile;
  }
}

export const sellerProfileStore = new SellerProfileStore();
