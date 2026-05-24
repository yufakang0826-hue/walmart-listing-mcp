// Write-tool tests for walmart-listing-mcp. Sandbox-only.
//
// Sandbox-specific findings (documented for reviewers — see also
// README "Sandbox quirks" section):
//   - Walmart sandbox's write endpoints return success for ANY SKU
//     regardless of ownership (mock-like). Production will reject
//     unauthorized SKUs with 4xx — re-verify there before relying on the
//     error path.
//   - submit_feed always returns a feedId; the feed's actual outcome
//     surfaces later via get_feed_status (often ERROR for our test feeds
//     because their GTINs are not registered).
//
// JSON-RPC error -32602 (Invalid params) is the stable signal that input
// validation rejected a call before any API request — preferred over
// matching MCP SDK error text.

import {
  connectMcp,
  createRecorder,
  requireSandbox,
  trim,
} from "./_helpers.mjs";

requireSandbox("creates feed submissions and calls retire_item");

const SCHEMA_ERR = /-32602/;

const r = createRecorder();
const { client, close } = await connectMcp("smoke-writes");

const tryCallTool = (args) =>
  client.callTool(args).catch((err) => ({
    isError: true,
    content: [{ type: "text", text: String(err) }],
  }));

try {
  r.record("connect", true);

  // ==============================================================
  // submit_feed — JSON object payload
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
  const feedId = feedHappy.structuredContent?.feedId;
  r.record(
    "submit_feed (JSON payload) returns feedId",
    feedHappy.isError !== true && typeof feedId === "string" && feedId.length > 0,
    feedHappy.isError !== true ? `feedId=${feedId}` : trim(feedHappy.content?.[0]?.text),
  );

  if (feedId) {
    const status = await client.callTool({ name: "walmart_get_feed_status", arguments: { feedId } });
    r.record(
      "get_feed_status returns status for the submitted feed",
      status.isError !== true && typeof status.structuredContent?.feedStatus === "string",
      `feedStatus=${status.structuredContent?.feedStatus}`,
    );
  }

  // submit_feed — XML string payload
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
  r.record(
    "submit_feed (XML string payload) accepted via union schema",
    feedXml.isError !== true && typeof feedXml.structuredContent?.feedId === "string",
    feedXml.isError === true
      ? trim(feedXml.content?.[0]?.text, 160)
      : `feedId=${feedXml.structuredContent?.feedId}`,
  );

  const feedNoPayload = await tryCallTool({ name: "walmart_submit_feed", arguments: { feedType: "MP_ITEM" } });
  r.record(
    "submit_feed without payload rejected at schema layer (no API call)",
    feedNoPayload.isError === true && SCHEMA_ERR.test(feedNoPayload.content?.[0]?.text || ""),
    trim(feedNoPayload.content?.[0]?.text, 160),
  );

  const feedBadType = await client.callTool({
    name: "walmart_submit_feed",
    arguments: { feedType: "TOTALLY_FAKE_FEED_TYPE", payload: { foo: "bar" } },
  });
  r.record(
    "submit_feed with invalid feedType returns API error",
    feedBadType.isError === true && /status 404|status 400/.test(feedBadType.content?.[0]?.text || ""),
    trim(feedBadType.content?.[0]?.text, 160),
  );

  // ==============================================================
  // update_inventory
  // ==============================================================
  const invHappy = await client.callTool({
    name: "walmart_update_inventory",
    arguments: {
      sku: "smoke-test-sku",
      payload: { sku: "smoke-test-sku", quantity: { unit: "EACH", amount: 5 } },
    },
  });
  r.record(
    "update_inventory (sandbox mock) returns success shape",
    invHappy.isError !== true && invHappy.structuredContent !== undefined,
    `sandbox echoes back: ${trim(JSON.stringify(invHappy.structuredContent), 120)}`,
  );

  const invNoPayload = await tryCallTool({ name: "walmart_update_inventory", arguments: { sku: "any" } });
  r.record(
    "update_inventory without payload rejected at schema layer (no API call)",
    invNoPayload.isError === true && SCHEMA_ERR.test(invNoPayload.content?.[0]?.text || ""),
    trim(invNoPayload.content?.[0]?.text, 160),
  );

  const invEmpty = await client.callTool({
    name: "walmart_update_inventory",
    arguments: { sku: "any", payload: {} },
  });
  r.record(
    "update_inventory with empty payload returns API error",
    invEmpty.isError === true,
    trim(invEmpty.content?.[0]?.text, 160),
  );

  // ==============================================================
  // update_price (v1.0.0 — typed args; payload built internally)
  // ==============================================================
  const priceHappy = await client.callTool({
    name: "walmart_update_price",
    arguments: { sku: "smoke-test-sku", amount: 12.34 },
  });
  r.record(
    "update_price (sandbox mock, typed args) returns success",
    priceHappy.isError !== true,
    trim(priceHappy.content?.[0]?.text, 120),
  );

  const priceNoSku = await tryCallTool({ name: "walmart_update_price", arguments: { amount: 9.99 } });
  r.record(
    "update_price without sku rejected at schema layer",
    priceNoSku.isError === true && SCHEMA_ERR.test(priceNoSku.content?.[0]?.text || ""),
    trim(priceNoSku.content?.[0]?.text, 160),
  );

  const priceWrongCurrency = await tryCallTool({
    name: "walmart_update_price",
    arguments: { sku: "smoke-test-sku", amount: 9.99, currency: "MXN" },
  });
  r.record(
    "update_price with wrong currency for active market rejected pre-API",
    priceWrongCurrency.isError === true && /does not match active market/i.test(priceWrongCurrency.content?.[0]?.text || ""),
    trim(priceWrongCurrency.content?.[0]?.text, 160),
  );

  // ==============================================================
  // update_promo_price (v1.0.0 — new tool)
  // ==============================================================
  const promoStart = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // +2h
  const promoEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // +7d
  const promoHappy = await client.callTool({
    name: "walmart_update_promo_price",
    arguments: { sku: "smoke-test-sku", promoAmount: 9.99, basePrice: 12.34, effectiveDate: promoStart, expirationDate: promoEnd },
  });
  r.record(
    "update_promo_price (sandbox mock, typed args) returns success",
    promoHappy.isError !== true,
    trim(promoHappy.content?.[0]?.text, 120),
  );

  const promoInverted = await tryCallTool({
    name: "walmart_update_promo_price",
    arguments: { sku: "smoke-test-sku", promoAmount: 20, basePrice: 10, effectiveDate: promoStart, expirationDate: promoEnd },
  });
  r.record(
    "update_promo_price rejects promoAmount >= basePrice pre-API",
    promoInverted.isError === true && /must be less than basePrice/i.test(promoInverted.content?.[0]?.text || ""),
    trim(promoInverted.content?.[0]?.text, 160),
  );

  // ==============================================================
  // retire_item
  // ==============================================================
  const retireHappy = await client.callTool({
    name: "walmart_retire_item",
    arguments: { sku: `smoke-retire-test-${Date.now()}` },
  });
  r.record(
    "retire_item (sandbox mock) returns success shape",
    retireHappy.isError !== true && retireHappy.structuredContent?.success === true,
    `message: ${trim(retireHappy.structuredContent?.result?.message, 80)}`,
  );

  const retireNoSku = await tryCallTool({ name: "walmart_retire_item", arguments: {} });
  r.record(
    "retire_item without sku rejected at schema layer (no API call)",
    retireNoSku.isError === true && SCHEMA_ERR.test(retireNoSku.content?.[0]?.text || ""),
    trim(retireNoSku.content?.[0]?.text, 160),
  );

  // ==============================================================
  // External-content invariants on write responses
  // ==============================================================
  const sourceCheck = invHappy.structuredContent?._source === "walmart_api_untrusted"
    && priceHappy.structuredContent?._source === "walmart_api_untrusted"
    && retireHappy.structuredContent?._source === "walmart_api_untrusted";
  r.record(
    "successful write responses carry _source=walmart_api_untrusted",
    sourceCheck,
    `inventory=${invHappy.structuredContent?._source}, price=${priceHappy.structuredContent?._source}, retire=${retireHappy.structuredContent?._source}`,
  );

  const prefixCheck = invHappy.content?.[0]?.text?.startsWith("// EXTERNAL DATA")
    && priceHappy.content?.[0]?.text?.startsWith("// EXTERNAL DATA")
    && retireHappy.content?.[0]?.text?.startsWith("// EXTERNAL DATA");
  r.record(
    "successful write responses prefixed with EXTERNAL warning",
    prefixCheck,
    `inv=${invHappy.content?.[0]?.text?.slice(0, 30)}…, price=${priceHappy.content?.[0]?.text?.slice(0, 30)}…, retire=${retireHappy.content?.[0]?.text?.slice(0, 30)}…`,
  );
} catch (err) {
  r.record("fatal", false, trim(String(err)));
} finally {
  await close();
}

r.finish();
