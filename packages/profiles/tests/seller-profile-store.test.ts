import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sellerProfileStore } from "../src/seller-profile-store.js";

const ORIGINAL_ENV = process.env.WALMART_SELLER_PROFILE_STORE;

let tempDir: string;
let storePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "walmart-profile-test-"));
  storePath = join(tempDir, "profiles.json");
  process.env.WALMART_SELLER_PROFILE_STORE = storePath;
  sellerProfileStore.invalidateCache();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.WALMART_SELLER_PROFILE_STORE;
  } else {
    process.env.WALMART_SELLER_PROFILE_STORE = ORIGINAL_ENV;
  }
  rmSync(tempDir, { recursive: true, force: true });
  sellerProfileStore.invalidateCache();
});

describe("sellerProfileStore", () => {
  it("returns empty list when file does not exist", () => {
    expect(sellerProfileStore.listProfiles()).toEqual([]);
    expect(sellerProfileStore.getActiveProfileId()).toBeUndefined();
    expect(sellerProfileStore.hasProfiles()).toBe(false);
  });

  it("upsert creates a new profile and marks it active by default", () => {
    const created = sellerProfileStore.upsertProfile("acme-us", {
      market: "us",
      clientId: "id-1",
      clientSecret: "secret-1",
    });
    expect(created.sellerProfileId).toBe("acme-us");
    expect(created.market).toBe("us");
    expect(created.clientId).toBe("id-1");
    expect(sellerProfileStore.getActiveProfileId()).toBe("acme-us");
  });

  it("upsert merges fields with existing profile data", () => {
    sellerProfileStore.upsertProfile("acme-us", { market: "us", clientId: "id-1", clientSecret: "secret-1" });
    sellerProfileStore.upsertProfile("acme-us", { channelType: "channel-uuid" });
    const profile = sellerProfileStore.getProfile("acme-us");
    expect(profile?.clientId).toBe("id-1");
    expect(profile?.clientSecret).toBe("secret-1");
    expect(profile?.channelType).toBe("channel-uuid");
    expect(profile?.market).toBe("us");
  });

  it("upsert rejects a new profile without market", () => {
    expect(() => sellerProfileStore.upsertProfile("acme-no-market", { clientId: "id", clientSecret: "secret" })).toThrow(/market is required/);
  });

  it("upsert rejects an invalid market enum value", () => {
    expect(() => sellerProfileStore.upsertProfile("acme-x", { market: "uk" as never, clientId: "id", clientSecret: "secret" })).toThrow(/Invalid market/);
  });

  it("supports all four Global API markets", () => {
    sellerProfileStore.upsertProfile("acme-us", { market: "us", clientId: "1", clientSecret: "1" });
    sellerProfileStore.upsertProfile("acme-mx", { market: "mx", clientId: "2", clientSecret: "2" });
    sellerProfileStore.upsertProfile("acme-ca", { market: "ca", clientId: "3", clientSecret: "3" });
    sellerProfileStore.upsertProfile("acme-cl", { market: "cl", clientId: "4", clientSecret: "4" });
    const profiles = sellerProfileStore.listProfiles();
    expect(profiles.map((p) => p.market).sort()).toEqual(["ca", "cl", "mx", "us"]);
  });

  it("setActiveProfile throws for unknown profile", () => {
    expect(() => sellerProfileStore.setActiveProfile("missing")).toThrow(/not found/);
  });

  it("setActiveProfile updates the active id without losing other fields", () => {
    sellerProfileStore.upsertProfile("a", { market: "us", clientId: "1", clientSecret: "1" });
    sellerProfileStore.upsertProfile("b", { market: "us", clientId: "2", clientSecret: "2" });
    sellerProfileStore.setActiveProfile("b");
    expect(sellerProfileStore.getActiveProfileId()).toBe("b");
    expect(sellerProfileStore.listProfiles()).toHaveLength(2);
  });

  it("writes valid JSON to disk that survives a fresh read", () => {
    sellerProfileStore.upsertProfile("acme-us", { market: "us", clientId: "id-1", clientSecret: "secret-1" });
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw) as { activeSellerProfileId: string; profiles: Record<string, unknown> };
    expect(parsed.activeSellerProfileId).toBe("acme-us");
    expect(parsed.profiles["acme-us"]).toBeDefined();

    sellerProfileStore.invalidateCache();
    expect(sellerProfileStore.getProfile("acme-us")?.clientId).toBe("id-1");
  });

  it("does not leave temp files behind after writes", () => {
    sellerProfileStore.upsertProfile("acme-us", { market: "us", clientId: "id-1", clientSecret: "secret-1" });
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(tempDir);
    expect(files.filter((f: string) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("applies 0o600 permissions on POSIX after write", () => {
    if (process.platform === "win32") {
      return; // Windows ACL semantics differ; chmod is best-effort there.
    }
    sellerProfileStore.upsertProfile("acme-us", { market: "us", clientId: "id-1", clientSecret: "secret-1" });
    const mode = statSync(storePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("recovers from a corrupted-but-empty file as if empty", () => {
    writeFileSync(storePath, "", "utf-8");
    sellerProfileStore.invalidateCache();
    expect(sellerProfileStore.listProfiles()).toEqual([]);
  });

  it("migrates legacy v0.x profile (no market field) to market=us", () => {
    const legacy = {
      activeSellerProfileId: "legacy-us",
      profiles: {
        "legacy-us": {
          sellerProfileId: "legacy-us",
          marketplace: "US",
          clientId: "legacy-id",
          clientSecret: "legacy-secret",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(storePath, JSON.stringify(legacy, null, 2), "utf-8");
    sellerProfileStore.invalidateCache();
    const profile = sellerProfileStore.getProfile("legacy-us");
    expect(profile?.market).toBe("us");
    expect(profile?.clientId).toBe("legacy-id");
    expect(profile).not.toHaveProperty("marketplace");
  });

  it("migrates legacy profile whose marketplace=MX to market=mx", () => {
    const legacy = {
      profiles: {
        "legacy-mx": {
          sellerProfileId: "legacy-mx",
          marketplace: "MX",
          clientId: "x",
          clientSecret: "y",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(storePath, JSON.stringify(legacy, null, 2), "utf-8");
    sellerProfileStore.invalidateCache();
    expect(sellerProfileStore.getProfile("legacy-mx")?.market).toBe("mx");
  });
});
