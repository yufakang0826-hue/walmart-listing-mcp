// Read-API smoke test — requires WALMART_CLIENT_ID + WALMART_CLIENT_SECRET
// in .env. Runs against the live Walmart API (sandbox if WALMART_SANDBOX=true,
// otherwise production).

import { connectMcp, createRecorder, isExternalResponse, trim } from "./_helpers.mjs";

const r = createRecorder();
const { client, close } = await connectMcp("smoke-api");

try {
  r.record("connect", true);

  const verify = await client.callTool({ name: "walmart_verify_credentials", arguments: {} });
  const verifyOk = verify.isError !== true;
  r.record(
    "walmart_verify_credentials succeeds",
    verifyOk,
    verifyOk
      ? `tokenType=${verify.structuredContent?.tokenType}, expiresIn=${verify.structuredContent?.expiresIn}`
      : trim(verify.content?.[0]?.text),
  );

  if (!verifyOk) {
    throw new Error("Auth failed — skipping remaining tests");
  }

  const status = await client.callTool({ name: "walmart_get_token_status", arguments: {} });
  r.record(
    "walmart_get_token_status reports authenticated",
    status.structuredContent?.authenticated === true && status.structuredContent?.hasClientCredentials === true,
    trim(JSON.stringify(status.structuredContent)),
  );

  const tax = await client.callTool({ name: "walmart_get_taxonomy", arguments: {} });
  const taxOk = tax.isError !== true;
  r.record(
    "walmart_get_taxonomy succeeds",
    taxOk,
    taxOk ? `text preview: ${trim(tax.content?.[0]?.text, 80)}` : trim(tax.content?.[0]?.text),
  );
  if (taxOk) {
    r.record(
      "taxonomy response has external markers (EXTERNAL prefix + _source)",
      isExternalResponse(tax),
      `first 80: ${trim(tax.content?.[0]?.text, 80)} / _source=${tax.structuredContent?._source}`,
    );
  }

  const dept = await client.callTool({ name: "walmart_get_departments", arguments: {} });
  r.record(
    "walmart_get_departments succeeds",
    dept.isError !== true,
    `keys: ${Object.keys(dept.structuredContent || {}).slice(0, 6).join(",")}`,
  );

  const items = await client.callTool({ name: "walmart_get_items", arguments: { limit: 1 } });
  const itemCount = Array.isArray(items.structuredContent?.ItemResponse)
    ? items.structuredContent.ItemResponse.length
    : 0;
  r.record(
    "walmart_get_items?limit=1 returns",
    items.isError !== true,
    `items=${itemCount}, totalItems=${items.structuredContent?.totalItems ?? "unset"}`,
  );

  const firstItem = items.structuredContent?.ItemResponse?.[0];
  const sku = typeof firstItem?.sku === "string" ? firstItem.sku : null;
  if (sku) {
    const item = await client.callTool({ name: "walmart_get_item", arguments: { sku } });
    const tool404 = item.isError === true && /status 404/.test(item.content?.[0]?.text || "");
    r.record(
      `walmart_get_item({sku}) responds cleanly (200 or 404)`,
      item.isError !== true || tool404,
      item.isError !== true
        ? `200 OK, keys: ${Object.keys(item.structuredContent || {}).slice(0, 6).join(",")}`
        : `404 from sandbox (expected — sandbox catalog inconsistency)`,
    );
  } else {
    r.record("walmart_get_item skipped — no SKU available", true);
  }

  const upsert = await client.callTool({
    name: "walmart_upsert_seller_profile",
    arguments: {
      sellerProfileId: "smoke-test-profile",
      sellerProfileLabel: "smoke",
      marketplace: "US",
      setActive: true,
    },
  });
  r.record(
    "walmart_upsert_seller_profile (local write)",
    upsert.isError !== true && upsert.structuredContent?.sellerProfileId === "smoke-test-profile",
    trim(JSON.stringify(upsert.structuredContent)),
  );

  const profiles = await client.callTool({ name: "walmart_list_seller_profiles", arguments: {} });
  const profileList = profiles.structuredContent?.sellerProfiles || [];
  r.record(
    "walmart_list_seller_profiles sees the new profile",
    profileList.some((p) => p.sellerProfileId === "smoke-test-profile"),
    `${profileList.length} profile(s) in store`,
  );
} catch (err) {
  r.record("fatal", false, trim(String(err)));
} finally {
  await close();
}

r.finish();
