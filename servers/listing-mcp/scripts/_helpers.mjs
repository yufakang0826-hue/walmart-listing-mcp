// Shared helpers for the scripts/ smoke tests and probes.
//
// All scripts spawn `node dist/index.js` over stdio and talk to it as an
// MCP client. The boilerplate (env loading, sandbox guard, recorder,
// client setup) lives here so the actual tests stay focused.

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  UNTRUSTED_PREFIX,
  UNTRUSTED_SOURCE_MARKER,
} from "../dist/helper/format.js";

export { UNTRUSTED_PREFIX, UNTRUSTED_SOURCE_MARKER };

// Refuse to run unless WALMART_SANDBOX=true. Call at the top of any
// script that issues writes or queries arbitrary SKUs.
export function requireSandbox(reasonShort) {
  if (process.env.WALMART_SANDBOX !== "true") {
    console.error(
      `Refusing to run: sandbox-only script (${reasonShort}). ` +
      `Set WALMART_SANDBOX=true in .env (currently: ${process.env.WALMART_SANDBOX || "undefined"}).`,
    );
    process.exit(1);
  }
}

// Construct + connect an MCP client over stdio against the built server.
// Returns { client, close } — close() always succeeds, suitable for finally{}.
export async function connectMcp(clientName) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client({ name: clientName, version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    close: () => client.close().catch(() => {}),
  };
}

// Trim long strings for readable test output.
export function trim(s, n = 240) {
  if (typeof s !== "string") s = JSON.stringify(s);
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…[truncated]`;
}

// Pass/fail recorder with summary + exit-code helper.
// Usage:
//   const r = createRecorder();
//   r.record("name", true, "detail");
//   r.finish();   // logs summary and exits with 0 or 1
export function createRecorder() {
  const results = [];
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

// Assert a tool response shows external/untrusted markers.
// Returns true if both the text prefix and structuredContent._source are set.
export function isExternalResponse(response) {
  const text = response?.content?.[0]?.text;
  const source = response?.structuredContent?._source;
  return (
    typeof text === "string"
    && text.startsWith(UNTRUSTED_PREFIX.trim())   // tolerate optional trailing \n
    && source === UNTRUSTED_SOURCE_MARKER
  );
}

// Assert a tool response is local (no untrusted markers).
export function isLocalResponse(response) {
  const text = response?.content?.[0]?.text || "";
  return (
    !text.startsWith("// EXTERNAL DATA")
    && response?.structuredContent?._source === undefined
  );
}
