// Headless smoke test for walmart-listing-mcp.
// Spawns the built stdio server, exercises the protocol, and reports pass/fail.
// Does NOT require Walmart credentials — only tests behavior that is
// observable without contacting the Walmart API.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOL_NAMES = new Set([
  "walmart_upsert_seller_profile",
  "walmart_list_seller_profiles",
  "walmart_set_active_seller_profile",
  "walmart_get_token_status",
  "walmart_verify_credentials",
  "walmart_get_items",
  "walmart_get_item",
  "walmart_get_item_status",
  "walmart_retire_item",
  "walmart_submit_feed",
  "walmart_get_feed_status",
  "walmart_get_feeds",
  "walmart_get_taxonomy",
  "walmart_get_departments",
  "walmart_get_inventory",
  "walmart_get_bulk_inventory",
  "walmart_update_inventory",
  "walmart_update_price",
]);

const REMOVED_WILDCARD_NAMES = ["walmart_invoke_listing_api", "walmart_invoke_api", "walmart_raw_request"];

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    ...process.env,
    WALMART_SELLER_PROFILE_STORE: "/tmp/smoke-profiles.json",
  },
});
const client = new Client({ name: "smoke-test", version: "0.0.1" }, { capabilities: {} });

try {
  await client.connect(transport);
  record("connect", true);

  const list = await client.listTools();
  const got = new Set(list.tools.map((t) => t.name));

  record("tool count is 18", got.size === 18, `actual=${got.size}`);

  const missing = [...EXPECTED_TOOL_NAMES].filter((n) => !got.has(n));
  record("all expected tools present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");

  const surprises = [...got].filter((n) => !EXPECTED_TOOL_NAMES.has(n));
  record("no unexpected tools", surprises.length === 0, surprises.length ? `extra: ${surprises.join(", ")}` : "");

  const wildcards = REMOVED_WILDCARD_NAMES.filter((n) => got.has(n));
  record("no wildcard tool", wildcards.length === 0, wildcards.length ? `still present: ${wildcards.join(", ")}` : "");

  const retire = list.tools.find((t) => t.name === "walmart_retire_item");
  const ann = retire?.annotations || {};
  record(
    "walmart_retire_item annotations correct",
    ann.destructiveHint === true && ann.idempotentHint === true && ann.openWorldHint === true && ann.readOnlyHint === false,
    `got ${JSON.stringify(ann)}`,
  );

  const getItems = list.tools.find((t) => t.name === "walmart_get_items");
  record("walmart_get_items has outputSchema", Boolean(getItems?.outputSchema), getItems?.outputSchema ? "" : "missing");

  const listProfiles = await client.callTool({ name: "walmart_list_seller_profiles", arguments: {} });
  record(
    "walmart_list_seller_profiles returns structuredContent",
    Boolean(listProfiles.structuredContent) && Array.isArray(listProfiles.structuredContent.sellerProfiles),
    `structuredContent=${JSON.stringify(listProfiles.structuredContent)}`,
  );
  record(
    "local response NOT prefixed with EXTERNAL warning",
    typeof listProfiles.content?.[0]?.text === "string" && !listProfiles.content[0].text.includes("EXTERNAL DATA"),
  );
  record(
    "local response NOT marked with _source",
    !listProfiles.structuredContent?._source,
  );

  let rejected = false;
  let rejectMsg = "";
  try {
    const r = await client.callTool({
      name: "walmart_get_items",
      arguments: { limit: 1, nonExistentField: true },
    });
    rejected = r.isError === true;
    rejectMsg = r.content?.[0]?.text?.slice(0, 200) || "(no text)";
  } catch (err) {
    rejected = true;
    rejectMsg = String(err).slice(0, 200);
  }
  record("strict schema rejects unknown field", rejected, rejected ? "" : `unexpected accept: ${rejectMsg}`);

  let verifyRejected = false;
  let verifyMsg = "";
  try {
    const r = await client.callTool({ name: "walmart_verify_credentials", arguments: {} });
    verifyRejected = r.isError === true;
    verifyMsg = r.content?.[0]?.text?.slice(0, 200) || "(no text)";
  } catch (err) {
    verifyRejected = true;
    verifyMsg = String(err).slice(0, 200);
  }
  record(
    "walmart_verify_credentials fails cleanly without creds",
    verifyRejected,
    verifyRejected ? "errored as expected" : `unexpected success: ${verifyMsg}`,
  );
} catch (err) {
  record("fatal", false, String(err));
} finally {
  await client.close();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
