import { describe, expect, it } from "vitest";
import { formatError } from "../src/helper/format.js";

describe("formatError", () => {
  it("redacts secret-like fields nested inside error details", () => {
    const err = new Error("boom") as Error & { details?: unknown };
    err.details = {
      clientSecret: "abc123",
      access_token: "xyz",
      authorization: "Bearer foo",
      apiKey: "secret-key",
      Password: "hunter2",
      marketplace: "US",
    };
    const out = JSON.parse(formatError(err)) as { details: Record<string, string> };
    expect(out.details.clientSecret).toBe("[REDACTED]");
    expect(out.details.access_token).toBe("[REDACTED]");
    expect(out.details.authorization).toBe("[REDACTED]");
    expect(out.details.apiKey).toBe("[REDACTED]");
    expect(out.details.Password).toBe("[REDACTED]");
    expect(out.details.marketplace).toBe("US");
  });

  it("redacts secrets recursively inside nested objects and arrays", () => {
    const err = new Error("boom") as Error & { details?: unknown };
    err.details = {
      errors: [{ code: "AUTH", description: "bad", clientSecret: "leaked" }],
      meta: { nested: { token: "leaked" } },
    };
    const out = JSON.parse(formatError(err)) as {
      details: { errors: Array<Record<string, string>>; meta: { nested: { token: string } } };
    };
    expect(out.details.errors[0]?.clientSecret).toBe("[REDACTED]");
    expect(out.details.errors[0]?.description).toBe("bad");
    expect(out.details.meta.nested.token).toBe("[REDACTED]");
  });

  it("truncates very long string values", () => {
    const err = new Error("boom") as Error & { details?: unknown };
    err.details = "x".repeat(1500);
    const out = JSON.parse(formatError(err)) as { details: string };
    expect(out.details.endsWith("...[truncated]")).toBe(true);
    expect(out.details.length).toBeLessThan(1500);
  });

  it("does not include the stack trace in output", () => {
    const err = new Error("boom");
    const out = JSON.parse(formatError(err)) as { stack?: string; name: string; message: string };
    expect(out.stack).toBeUndefined();
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
  });

  it("formats non-Error values with a message field", () => {
    const out = JSON.parse(formatError("just a string")) as { message: string };
    expect(out.message).toBe("just a string");
  });

  it("caps recursion depth to avoid infinite traversal", () => {
    const err = new Error("boom") as Error & { details?: unknown };
    type Deep = { next?: Deep; level: number };
    const root: Deep = { level: 0 };
    let cur = root;
    for (let i = 1; i < 10; i += 1) {
      cur.next = { level: i };
      cur = cur.next;
    }
    err.details = root;
    const serialized = formatError(err);
    expect(serialized).toContain("[truncated]");
  });
});
