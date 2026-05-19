// Structural smoke test — no credentials required.
// Verifies tool inventory, annotations, schema rejection, local response shape.

import { connectMcp, createRecorder, isLocalResponse } from "./_helpers.mjs";

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

const REMOVED_WILDCARDS = ["walmart_invoke_listing_api", "walmart_invoke_api", "walmart_raw_request"];

const r = createRecorder();
const { client, close } = await connectMcp("smoke-test");

try {
  r.record("connect", true);

  const list = await client.listTools();
  const got = new Set(list.tools.map((t) => t.name));

  r.record("tool count is 18", got.size === 18, `actual=${got.size}`);

  const missing = [...EXPECTED_TOOL_NAMES].filter((n) => !got.has(n));
  r.record("all expected tools present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");

  const surprises = [...got].filter((n) => !EXPECTED_TOOL_NAMES.has(n));
  r.record("no unexpected tools", surprises.length === 0, surprises.length ? `extra: ${surprises.join(", ")}` : "");

  const wildcards = REMOVED_WILDCARDS.filter((n) => got.has(n));
  r.record("no wildcard tool", wildcards.length === 0, wildcards.length ? `still present: ${wildcards.join(", ")}` : "");

  const retire = list.tools.find((t) => t.name === "walmart_retire_item");
  const ann = retire?.annotations || {};
  r.record(
    "walmart_retire_item annotations correct",
    ann.destructiveHint === true && ann.idempotentHint === true && ann.openWorldHint === true && ann.readOnlyHint === false,
    `got ${JSON.stringify(ann)}`,
  );

  const getItems = list.tools.find((t) => t.name === "walmart_get_items");
  r.record("walmart_get_items has outputSchema", Boolean(getItems?.outputSchema), getItems?.outputSchema ? "" : "missing");

  const listProfiles = await client.callTool({ name: "walmart_list_seller_profiles", arguments: {} });
  r.record(
    "walmart_list_seller_profiles returns structuredContent",
    Boolean(listProfiles.structuredContent) && Array.isArray(listProfiles.structuredContent.sellerProfiles),
    `structuredContent=${JSON.stringify(listProfiles.structuredContent)}`,
  );
  r.record(
    "local response has no external markers",
    isLocalResponse(listProfiles),
  );

  let rejected = false;
  try {
    const resp = await client.callTool({
      name: "walmart_get_items",
      arguments: { limit: 1, nonExistentField: true },
    });
    rejected = resp.isError === true;
  } catch {
    rejected = true;
  }
  r.record("strict schema rejects unknown field", rejected);
} catch (err) {
  r.record("fatal", false, String(err).slice(0, 200));
} finally {
  await close();
}

r.finish();
