// Comprehensive write-tool tests for walmart-listing-mcp.
//
// SANDBOX BEHAVIOR (discovered empirically):
//   - get_items returns the sandbox-global catalog, not seller-owned items.
//   - Write endpoints (update_inventory, update_price, retire_item) act as a
//     mock: they return a success message for ANY SKU regardless of ownership.
//     This means we cannot verify "foreign SKU should fail" against sandbox —
//     production will behave differently.
//   - submit_feed returns a feedId for any payload; the feed itself may then
//     fail processing (visible via get_feed_status).
//
// What we DO test here:
//   1. Happy path wiring — request goes through, response shape parses.
//   2. Schema-layer rejection — missing required fields fail before any API call.
//   3. Walmart-side validation rejection — empty / structurally invalid bodies
//      that the API itself rejects with 400 / 404.

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// SAFETY: this script creates submit_feed entries and calls retire_item.
// Refuse to run anywhere except sandbox.
if (process.env.WALMART_SANDBOX !== "true") {
  console.error(
    `Refusing to run: sandbox-only script. ` +
    `Set WALMART_SANDBOX=true in .env (currently: ${process.env.WALMART_SANDBOX || "undefined"}).`,
  );
  process.exit(1);
}

// Match the JSON-RPC error code for "Invalid params" — stable across MCP
// SDK message rewordings. See https://www.jsonrpc.org/specification#error_object
const SCHEMA_ERR = /-32602/;

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function trim(s, n = 240) {
  if (typeof s !== "string") s = JSON.stringify(s);
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…[truncated]`;
}

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke-writes", version: "0.0.1" }, { capabilities: {} });

try {
  await client.connect(transport);
  record("connect", true);

  // ==============================================================
  // submit_feed
  // ==============================================================
  const testSku = `smoke-${Date.now()}`;
  const minimalMpItem = {
    MPItemFeedHeader: { version: "4.2", sellingChannel: "marketplace", locale: "en" },
    MPItem: [{
      Item: {
        sku: testSku,
        productIdentifiers: { productIdType: "GTIN", productId: "00193514013203" },
        productName: `Smoke Test Item ${testSku}`,
        ShippingWeight: 1.0,
        price: 9.99,
        shortDescription: "Smoke test item.",
      },
    }],
  };

  const feedHappy = await client.callTool({
    name: "walmart_submit_feed",
    arguments: { feedType: "MP_ITEM", payload: minimalMpItem, contentType: "application/json" },
  });
  const feedHappyOk = feedHappy.isError !== true;
  const feedId = feedHappy.structuredContent?.feedId;
  record(
    "submit_feed (valid MP_ITEM payload) returns feedId",
    feedHappyOk && typeof feedId === "string" && feedId.length > 0,
    feedHappyOk ? `feedId=${feedId}` : trim(feedHappy.content?.[0]?.text),
  );

  if (feedHappyOk && feedId) {
    const status = await client.callTool({ name: "walmart_get_feed_status", arguments: { feedId } });
    record(
      "get_feed_status returns status for the submitted feed",
      status.isError !== true && typeof status.structuredContent?.feedStatus === "string",
      `feedStatus=${status.structuredContent?.feedStatus}`,
    );
  }

  // XML string payload — exercises the string branch of payload's union type
  const xmlSku = `smoke-xml-${Date.now()}`;
  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<MPItemFeed xmlns="http://walmart.com/">
  <MPItemFeedHeader>
    <version>4.2</version>
    <sellingChannel>marketplace</sellingChannel>
    <locale>en</locale>
  </MPItemFeedHeader>
  <MPItem>
    <Item>
      <sku>${xmlSku}</sku>
      <productName>Smoke Test XML Item</productName>
    </Item>
  </MPItem>
</MPItemFeed>`;
  const feedXml = await client.callTool({
    name: "walmart_submit_feed",
    arguments: { feedType: "MP_ITEM", payload: xmlPayload, contentType: "application/xml" },
  });
  record(
    "submit_feed (XML string payload) accepted via union schema",
    feedXml.isError !== true && typeof feedXml.structuredContent?.feedId === "string",
    feedXml.isError === true
      ? trim(feedXml.content?.[0]?.text, 160)
      : `feedId=${feedXml.structuredContent?.feedId}`,
  );

  // Schema-layer: missing payload should fail BEFORE any API call
  const feedNoPayload = await client.callTool({
    name: "walmart_submit_feed",
    arguments: { feedType: "MP_ITEM" },
  }).catch((err) => ({ isError: true, content: [{ type: "text", text: String(err) }] }));
  const feedNoPayloadIsSchemaErr = feedNoPayload.isError === true
    && SCHEMA_ERR.test(feedNoPayload.content?.[0]?.text || "");
  record(
    "submit_feed without payload rejected at schema layer (no API call)",
    feedNoPayloadIsSchemaErr,
    trim(feedNoPayload.content?.[0]?.text, 160),
  );

  // Walmart-side: invalid feedType should 404
  const feedBadType = await client.callTool({
    name: "walmart_submit_feed",
    arguments: { feedType: "TOTALLY_FAKE_FEED_TYPE", payload: { foo: "bar" } },
  });
  record(
    "submit_feed with invalid feedType returns API error",
    feedBadType.isError === true && /status 404|status 400/.test(feedBadType.content?.[0]?.text || ""),
    trim(feedBadType.content?.[0]?.text, 160),
  );

  // ==============================================================
  // update_inventory
  // ==============================================================
  // Happy path against sandbox mock — confirms request goes through
  const invHappy = await client.callTool({
    name: "walmart_update_inventory",
    arguments: {
      sku: "smoke-test-sku",
      payload: { sku: "smoke-test-sku", quantity: { unit: "EACH", amount: 5 } },
    },
  });
  record(
    "update_inventory (sandbox mock) returns success shape",
    invHappy.isError !== true && invHappy.structuredContent !== undefined,
    `sandbox echoes back: ${trim(JSON.stringify(invHappy.structuredContent), 120)}`,
  );

  // Schema-layer: missing payload (now should be required after fix)
  const invNoPayload = await client.callTool({
    name: "walmart_update_inventory",
    arguments: { sku: "any" },
  }).catch((err) => ({ isError: true, content: [{ type: "text", text: String(err) }] }));
  const invNoPayloadIsSchemaErr = invNoPayload.isError === true
    && SCHEMA_ERR.test(invNoPayload.content?.[0]?.text || "");
  record(
    "update_inventory without payload rejected at schema layer (no API call)",
    invNoPayloadIsSchemaErr,
    trim(invNoPayload.content?.[0]?.text, 160),
  );

  // Walmart-side: empty object payload returns 400
  const invEmpty = await client.callTool({
    name: "walmart_update_inventory",
    arguments: { sku: "any", payload: {} },
  });
  record(
    "update_inventory with empty payload returns API error",
    invEmpty.isError === true,
    trim(invEmpty.content?.[0]?.text, 160),
  );

  // ==============================================================
  // update_price
  // ==============================================================
  const priceHappy = await client.callTool({
    name: "walmart_update_price",
    arguments: {
      payload: {
        Price: {
          itemIdentifier: { sku: "smoke-test-sku", productIdType: "SKU" },
          pricingList: { pricing: [{ currentPrice: { value: { amount: 12.34, currency: "USD" } } }] },
        },
      },
    },
  });
  record(
    "update_price (sandbox mock) returns success shape",
    priceHappy.isError !== true && priceHappy.structuredContent?.ItemPriceResponse !== undefined,
    `message: ${trim(priceHappy.structuredContent?.ItemPriceResponse?.message, 80)}`,
  );

  // Schema-layer: missing payload
  const priceNoPayload = await client.callTool({
    name: "walmart_update_price",
    arguments: {},
  }).catch((err) => ({ isError: true, content: [{ type: "text", text: String(err) }] }));
  record(
    "update_price without payload rejected at schema layer (no API call)",
    priceNoPayload.isError === true && SCHEMA_ERR.test(priceNoPayload.content?.[0]?.text || ""),
    trim(priceNoPayload.content?.[0]?.text, 160),
  );

  // Walmart-side: empty body
  const priceEmpty = await client.callTool({
    name: "walmart_update_price",
    arguments: { payload: {} },
  });
  record(
    "update_price with empty payload returns API error",
    priceEmpty.isError === true,
    trim(priceEmpty.content?.[0]?.text, 160),
  );

  // ==============================================================
  // retire_item
  // ==============================================================
  // Use a never-real SKU so even if sandbox is "live" we don't retire anything.
  const retireHappy = await client.callTool({
    name: "walmart_retire_item",
    arguments: { sku: `smoke-retire-test-${Date.now()}` },
  });
  record(
    "retire_item (sandbox mock) returns success shape",
    retireHappy.isError !== true && retireHappy.structuredContent?.success === true,
    `message: ${trim(retireHappy.structuredContent?.result?.message, 80)}`,
  );

  // Schema-layer: missing sku
  const retireNoSku = await client.callTool({
    name: "walmart_retire_item",
    arguments: {},
  }).catch((err) => ({ isError: true, content: [{ type: "text", text: String(err) }] }));
  record(
    "retire_item without sku rejected at schema layer (no API call)",
    retireNoSku.isError === true && SCHEMA_ERR.test(retireNoSku.content?.[0]?.text || ""),
    trim(retireNoSku.content?.[0]?.text, 160),
  );

  // ==============================================================
  // Cross-cutting: external responses carry untrusted markers
  // ==============================================================
  record(
    "successful write responses carry _source=walmart_api_untrusted",
    invHappy.structuredContent?._source === "walmart_api_untrusted"
      && priceHappy.structuredContent?._source === "walmart_api_untrusted"
      && retireHappy.structuredContent?._source === "walmart_api_untrusted",
    `inventory=${invHappy.structuredContent?._source}, price=${priceHappy.structuredContent?._source}, retire=${retireHappy.structuredContent?._source}`,
  );

  record(
    "successful write responses prefixed with EXTERNAL warning",
    typeof invHappy.content?.[0]?.text === "string"
      && invHappy.content[0].text.startsWith("// EXTERNAL DATA")
      && priceHappy.content?.[0]?.text?.startsWith("// EXTERNAL DATA")
      && retireHappy.content?.[0]?.text?.startsWith("// EXTERNAL DATA"),
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
