// API-layer smoke test for walmart-listing-mcp.
// Requires WALMART_CLIENT_ID + WALMART_CLIENT_SECRET in .env (loaded by
// the spawned server via dotenv/config). Hits the real Walmart sandbox.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Truncate any payload before printing so secrets in error bodies don't
// leak into the report.
function trim(s, n = 240) {
  if (typeof s !== "string") s = JSON.stringify(s);
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…[truncated]`;
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
});
const client = new Client({ name: "smoke-api", version: "0.0.1" }, { capabilities: {} });

try {
  await client.connect(transport);
  record("connect", true);

  // 1. Token fetch via real OAuth
  const verify = await client.callTool({ name: "walmart_verify_credentials", arguments: {} });
  const verifyOk = verify.isError !== true;
  record(
    "walmart_verify_credentials succeeds",
    verifyOk,
    verifyOk
      ? `tokenType=${verify.structuredContent?.tokenType}, expiresIn=${verify.structuredContent?.expiresIn}`
      : trim(verify.content?.[0]?.text),
  );

  if (!verifyOk) {
    // Don't waste API calls if auth is broken.
    throw new Error("Auth failed — skipping remaining tests");
  }

  // 2. Token status reflects the cached token
  const status = await client.callTool({ name: "walmart_get_token_status", arguments: {} });
  record(
    "walmart_get_token_status reports authenticated",
    status.structuredContent?.authenticated === true && status.structuredContent?.hasClientCredentials === true,
    trim(JSON.stringify(status.structuredContent)),
  );

  // 3. Taxonomy fetch — exercises external-response handling
  const tax = await client.callTool({ name: "walmart_get_taxonomy", arguments: {} });
  const taxOk = tax.isError !== true;
  record(
    "walmart_get_taxonomy succeeds against sandbox",
    taxOk,
    taxOk ? `text preview: ${trim(tax.content?.[0]?.text, 80)}` : trim(tax.content?.[0]?.text),
  );
  if (taxOk) {
    record(
      "external response is prefixed with EXTERNAL warning",
      typeof tax.content?.[0]?.text === "string" && tax.content[0].text.startsWith("// EXTERNAL DATA"),
      `first 80 chars: ${trim(tax.content?.[0]?.text, 80)}`,
    );
    record(
      "external response carries _source=walmart_api_untrusted",
      tax.structuredContent?._source === "walmart_api_untrusted",
      `_source=${tax.structuredContent?._source}`,
    );
  }

  // 4. Departments
  const dept = await client.callTool({ name: "walmart_get_departments", arguments: {} });
  const deptOk = dept.isError !== true;
  record(
    "walmart_get_departments succeeds against sandbox",
    deptOk,
    deptOk ? `keys: ${Object.keys(dept.structuredContent || {}).slice(0, 6).join(",")}` : trim(dept.content?.[0]?.text),
  );

  // 5. Items list (sandbox may be empty)
  const items = await client.callTool({ name: "walmart_get_items", arguments: { limit: 1 } });
  const itemsOk = items.isError !== true;
  const itemCount = Array.isArray(items.structuredContent?.ItemResponse)
    ? items.structuredContent.ItemResponse.length
    : 0;
  record(
    "walmart_get_items?limit=1 returns",
    itemsOk,
    itemsOk ? `items returned: ${itemCount}, totalItems=${items.structuredContent?.totalItems ?? "unset"}` : trim(items.content?.[0]?.text),
  );

  // 6. Per-SKU item lookup. Walmart sandbox sometimes returns SKUs in the
  // list endpoint that 404 on individual lookup — that is sandbox data
  // inconsistency, not a tool bug, so we accept both 200 and 404.
  const firstItem = items.structuredContent?.ItemResponse?.[0];
  const sku = typeof firstItem?.sku === "string" ? firstItem.sku : null;
  if (sku) {
    const item = await client.callTool({ name: "walmart_get_item", arguments: { sku } });
    const text = item.content?.[0]?.text || "";
    const tool404 = item.isError === true && /status 404/.test(text);
    const itemOk = item.isError !== true;
    record(
      `walmart_get_item({sku}) responds cleanly (200 or 404)`,
      itemOk || tool404,
      itemOk
        ? `200 OK, keys: ${Object.keys(item.structuredContent || {}).slice(0, 6).join(",")}`
        : tool404
          ? `404 from sandbox (expected — sandbox catalog inconsistency)`
          : trim(text),
    );
  } else {
    record("walmart_get_item skipped — no SKU available from get_items", true, "");
  }

  // 7. Local write + read round-trip
  const upsert = await client.callTool({
    name: "walmart_upsert_seller_profile",
    arguments: {
      sellerProfileId: "smoke-test-profile",
      sellerProfileLabel: "smoke",
      marketplace: "US",
      setActive: true,
    },
  });
  const upsertOk = upsert.isError !== true;
  record(
    "walmart_upsert_seller_profile (local write)",
    upsertOk && upsert.structuredContent?.sellerProfileId === "smoke-test-profile",
    trim(JSON.stringify(upsert.structuredContent)),
  );

  const profiles = await client.callTool({ name: "walmart_list_seller_profiles", arguments: {} });
  const profileList = profiles.structuredContent?.sellerProfiles || [];
  record(
    "walmart_list_seller_profiles sees the new profile",
    profileList.some((p) => p.sellerProfileId === "smoke-test-profile"),
    `${profileList.length} profile(s) in store`,
  );
} catch (err) {
  record("fatal", false, trim(String(err)));
} finally {
  await client.close();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
