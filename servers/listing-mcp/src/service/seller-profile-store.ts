import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_PROFILE_STORE_FILENAME = ".walmart-seller-profiles.json";

export interface SellerProfileRecord {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  marketplace: string;
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

function createEmptyStore(): SellerProfileStoreData {
  return { profiles: {} };
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
        const parsed = JSON.parse(content) as Partial<SellerProfileStoreData>;
        data = {
          activeSellerProfileId: parsed.activeSellerProfileId,
          profiles: parsed.profiles || {},
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
    const nextProfile: SellerProfileRecord = {
      ...(current || {}),
      ...updates,
      sellerProfileId: profileId,
      marketplace: updates.marketplace || current?.marketplace || "US",
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
