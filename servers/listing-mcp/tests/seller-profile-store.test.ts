import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sellerProfileStore } from "../src/service/seller-profile-store.js";

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
      clientId: "id-1",
      clientSecret: "secret-1",
      marketplace: "US",
    });
    expect(created.sellerProfileId).toBe("acme-us");
    expect(created.clientId).toBe("id-1");
    expect(sellerProfileStore.getActiveProfileId()).toBe("acme-us");
  });

  it("upsert merges fields with existing profile data", () => {
    sellerProfileStore.upsertProfile("acme-us", { clientId: "id-1", clientSecret: "secret-1" });
    sellerProfileStore.upsertProfile("acme-us", { channelType: "channel-uuid" });
    const profile = sellerProfileStore.getProfile("acme-us");
    expect(profile?.clientId).toBe("id-1");
    expect(profile?.clientSecret).toBe("secret-1");
    expect(profile?.channelType).toBe("channel-uuid");
  });

  it("setActiveProfile throws for unknown profile", () => {
    expect(() => sellerProfileStore.setActiveProfile("missing")).toThrow(/not found/);
  });

  it("setActiveProfile updates the active id without losing other fields", () => {
    sellerProfileStore.upsertProfile("a", { clientId: "1", clientSecret: "1" });
    sellerProfileStore.upsertProfile("b", { clientId: "2", clientSecret: "2", setActive: false } as never);
    sellerProfileStore.setActiveProfile("b");
    expect(sellerProfileStore.getActiveProfileId()).toBe("b");
    expect(sellerProfileStore.listProfiles()).toHaveLength(2);
  });

  it("writes valid JSON to disk that survives a fresh read", () => {
    sellerProfileStore.upsertProfile("acme-us", { clientId: "id-1", clientSecret: "secret-1" });
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw) as { activeSellerProfileId: string; profiles: Record<string, unknown> };
    expect(parsed.activeSellerProfileId).toBe("acme-us");
    expect(parsed.profiles["acme-us"]).toBeDefined();

    sellerProfileStore.invalidateCache();
    expect(sellerProfileStore.getProfile("acme-us")?.clientId).toBe("id-1");
  });

  it("does not leave temp files behind after writes", () => {
    sellerProfileStore.upsertProfile("acme-us", { clientId: "id-1", clientSecret: "secret-1" });
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(tempDir);
    expect(files.filter((f: string) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("applies 0o600 permissions on POSIX after write", () => {
    if (process.platform === "win32") {
      return; // Windows ACL semantics differ; chmod is best-effort there.
    }
    sellerProfileStore.upsertProfile("acme-us", { clientId: "id-1", clientSecret: "secret-1" });
    const mode = statSync(storePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("recovers from a corrupted-but-empty file as if empty", () => {
    writeFileSync(storePath, "", "utf-8");
    sellerProfileStore.invalidateCache();
    expect(sellerProfileStore.listProfiles()).toEqual([]);
  });
});
