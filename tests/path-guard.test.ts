import { describe, expect, it } from "vitest";
import { assertListingPathAllowed, listingPathPrefixes } from "../src/service/walmart-tools.js";

describe("assertListingPathAllowed", () => {
  it("accepts all listing prefixes", () => {
    for (const prefix of listingPathPrefixes) {
      expect(() => assertListingPathAllowed(prefix)).not.toThrow();
      expect(() => assertListingPathAllowed(`${prefix}/sub`)).not.toThrow();
    }
  });

  it("normalizes paths without a leading slash", () => {
    expect(() => assertListingPathAllowed("v3/items")).not.toThrow();
  });

  it("rejects paths outside the listing scope", () => {
    expect(() => assertListingPathAllowed("/v3/orders")).toThrow(/listing-only scope/);
    expect(() => assertListingPathAllowed("/v3/returns")).toThrow(/listing-only scope/);
    expect(() => assertListingPathAllowed("/")).toThrow(/listing-only scope/);
  });

  it("rejects literal dot-dot traversal attempts", () => {
    expect(() => assertListingPathAllowed("/v3/items/../orders")).toThrow(/traversal/);
    expect(() => assertListingPathAllowed("/v3/items/..")).toThrow(/traversal/);
    expect(() => assertListingPathAllowed("/v3/items/foo/../../orders")).toThrow(/traversal/);
  });

  it("rejects URL-encoded dot-dot traversal", () => {
    expect(() => assertListingPathAllowed("/v3/items/%2e%2e/orders")).toThrow(/traversal/);
    expect(() => assertListingPathAllowed("/v3/items/%2E%2E/orders")).toThrow(/traversal/);
  });

  it("rejects backslash escape attempts", () => {
    expect(() => assertListingPathAllowed("/v3/items\\..\\orders")).toThrow(/traversal/);
    expect(() => assertListingPathAllowed("/v3/items%5C..%5Corders")).toThrow(/traversal/);
  });

  it("accepts paths with query strings inside the allowlist", () => {
    expect(() => assertListingPathAllowed("/v3/items?limit=10&offset=0")).not.toThrow();
    expect(() => assertListingPathAllowed("/v3/feeds?feedType=MP_ITEM")).not.toThrow();
  });
});
