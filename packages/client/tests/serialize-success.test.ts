import { describe, expect, it } from "vitest";
import { serializeSuccess } from "../src/format.js";

describe("serializeSuccess", () => {
  describe("text content", () => {
    it("returns JSON-stringified text for object inputs", () => {
      const out = serializeSuccess({ a: 1, b: "hello" });
      expect(out.content[0]?.type).toBe("text");
      const parsed = JSON.parse(out.content[0]!.text) as { a: number; b: string };
      expect(parsed).toEqual({ a: 1, b: "hello" });
    });

    it("does not prepend the untrusted warning for local content", () => {
      const out = serializeSuccess({ sellerProfileId: "local-1" }, "local");
      expect(out.content[0]!.text.startsWith("//")).toBe(false);
    });

    it("prepends the untrusted-data warning for external content", () => {
      const out = serializeSuccess({ ItemResponse: [] }, "external");
      expect(out.content[0]!.text).toMatch(/EXTERNAL DATA from Walmart/);
      expect(out.content[0]!.text).toMatch(/untrusted user input/);
    });
  });

  describe("structuredContent", () => {
    it("returns the object as structuredContent when value is an object", () => {
      const value = { a: 1, nested: { b: 2 } };
      const out = serializeSuccess(value);
      expect(out.structuredContent).toEqual(value);
    });

    it("wraps arrays under an `items` key", () => {
      const out = serializeSuccess([1, 2, 3]);
      expect(out.structuredContent).toEqual({ items: [1, 2, 3] });
    });

    it("wraps scalar values under a `result` key", () => {
      const out = serializeSuccess("plain string");
      expect(out.structuredContent).toEqual({ result: "plain string" });
    });

    it("omits structuredContent for null/undefined inputs", () => {
      expect(serializeSuccess(null).structuredContent).toBeUndefined();
      expect(serializeSuccess(undefined).structuredContent).toBeUndefined();
    });

    it("adds _source marker for external content", () => {
      const out = serializeSuccess({ x: 1 }, "external");
      expect(out.structuredContent).toMatchObject({ x: 1, _source: "walmart_api_untrusted" });
    });

    it("adds _source marker on wrapped arrays from external content", () => {
      const out = serializeSuccess([{ sku: "A" }], "external");
      expect(out.structuredContent).toMatchObject({
        items: [{ sku: "A" }],
        _source: "walmart_api_untrusted",
      });
    });

    it("does not add _source marker for local content", () => {
      const out = serializeSuccess({ x: 1 }, "local");
      expect(out.structuredContent).not.toHaveProperty("_source");
    });
  });
});
