import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_PROFILE_STORE_FILENAME } from "../constant/constants.js";

export interface SellerProfileRecord {
  sellerProfileId: string;
  sellerProfileLabel?: string;
  marketplace: string;
  clientId?: string;
  clientSecret?: string;
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
  private get storePath(): string {
    return process.env.WALMART_SELLER_PROFILE_STORE || path.join(process.cwd(), DEFAULT_PROFILE_STORE_FILENAME);
  }

  private readStore(): SellerProfileStoreData {
    if (!fs.existsSync(this.storePath)) {
      return createEmptyStore();
    }

    const content = fs.readFileSync(this.storePath, "utf-8").trim();
    if (!content) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(content) as Partial<SellerProfileStoreData>;
    return {
      activeSellerProfileId: parsed.activeSellerProfileId,
      profiles: parsed.profiles || {},
    };
  }

  private writeStore(store: SellerProfileStoreData): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
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

    store.activeSellerProfileId = profileId;
    this.writeStore(store);
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

    store.profiles[profileId] = nextProfile;
    if (!store.activeSellerProfileId) {
      store.activeSellerProfileId = profileId;
    }
    this.writeStore(store);
    return nextProfile;
  }
}

export const sellerProfileStore = new SellerProfileStore();
