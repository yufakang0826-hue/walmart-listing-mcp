// @walmart-mcp/test-utils — shared smoke-test framework for all walmart-mcp
// servers. Each server's scripts/smoke-test*.mjs imports from this package.
//
// Provides: stdio MCP client spawn + connect, sandbox-only guard,
// pass/fail recorder, response-shape assertions for the external/local
// untrusted-data markers.

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { UNTRUSTED_PREFIX, UNTRUSTED_SOURCE_MARKER } from "@walmart-mcp/client";

export { UNTRUSTED_PREFIX, UNTRUSTED_SOURCE_MARKER };

/**
 * Refuse to run unless WALMART_SANDBOX=true. Call at the top of any
 * script that issues writes or queries arbitrary SKUs.
 */
export function requireSandbox(reasonShort: string): void {
  if (process.env.WALMART_SANDBOX !== "true") {
    console.error(
      `Refusing to run: sandbox-only script (${reasonShort}). ` +
      `Set WALMART_SANDBOX=true in .env (currently: ${process.env.WALMART_SANDBOX || "undefined"}).`,
    );
    process.exit(1);
  }
}

export interface ConnectedClient {
  client: Client;
  close: () => Promise<void>;
}

/**
 * Construct + connect an MCP client over stdio against the built server.
 * The server entrypoint defaults to `dist/index.js` relative to the
 * caller's CWD — override via `args` if your server lives elsewhere.
 *
 * Returns `{ client, close }` — close() always succeeds, suitable for `finally{}`.
 */
export async function connectMcp(
  clientName: string,
  options: { command?: string; args?: string[] } = {},
): Promise<ConnectedClient> {
  const transport = new StdioClientTransport({
    command: options.command ?? "node",
    args: options.args ?? ["dist/index.js"],
  });
  const client = new Client({ name: clientName, version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    close: () => client.close().catch(() => undefined),
  };
}

/** Trim long strings for readable test output. */
export function trim(input: unknown, n = 240): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…[truncated]`;
}

export interface TestRecorder {
  record(name: string, ok: boolean, detail?: string): void;
  finish(): never;
}

/**
 * Pass/fail recorder with summary + exit-code helper.
 *
 * Usage:
 *   const r = createRecorder();
 *   r.record("name", true, "detail");
 *   r.finish();   // logs summary and exits with 0 (all pass) or 1
 */
export function createRecorder(): TestRecorder {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  return {
    record(name, ok, detail = "") {
      results.push({ name, ok, detail });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    },
    finish() {
      const passed = results.filter((r) => r.ok).length;
      const failed = results.length - passed;
      console.log(`\n${passed} passed, ${failed} failed`);
      process.exit(failed === 0 ? 0 : 1);
    },
  };
}

interface MaybeToolResponse {
  content?: Array<{ text?: string }>;
  structuredContent?: { _source?: string };
}

/**
 * Assert a tool response shows external/untrusted markers.
 * Returns true if both the text prefix and structuredContent._source are set.
 */
export function isExternalResponse(response: MaybeToolResponse | undefined | null): boolean {
  const text = response?.content?.[0]?.text;
  const source = response?.structuredContent?._source;
  return (
    typeof text === "string"
    && text.startsWith(UNTRUSTED_PREFIX.trim())
    && source === UNTRUSTED_SOURCE_MARKER
  );
}

/** Assert a tool response is local (no untrusted markers). */
export function isLocalResponse(response: MaybeToolResponse | undefined | null): boolean {
  const text = response?.content?.[0]?.text || "";
  return (
    !text.startsWith("// EXTERNAL DATA")
    && response?.structuredContent?._source === undefined
  );
}
