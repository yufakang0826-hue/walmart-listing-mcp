// Diagnostic: print full structured responses for write tools so you can
// audit exactly what sandbox actually returned. Useful when smoke-test-writes
// "unexpectedly succeeded" — the actual response shape lives here.
import { connectMcp, requireSandbox } from "@walmart-mcp/test-utils";

requireSandbox("writes to Walmart");

const { client, close } = await connectMcp("inspect-writes");

async function dump(label, args) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await client.callTool(args);
    console.log("isError:", r.isError);
    console.log("structuredContent:", JSON.stringify(r.structuredContent, null, 2));
    console.log("text:", (r.content?.[0]?.text || "").slice(0, 400));
  } catch (err) {
    console.log("THROWN:", err instanceof Error ? err.message : String(err));
  }
}

try {
  await dump("submit_feed with string payload", {
    name: "walmart_submit_feed",
    arguments: {
      feedType: "MP_ITEM",
      payload: "this is not a valid feed",
      contentType: "application/json",
    },
  });

  await dump("update_inventory foreign SKU", {
    name: "walmart_update_inventory",
    arguments: {
      sku: "definitely-not-our-sku-zzz",
      payload: { sku: "definitely-not-our-sku-zzz", quantity: { unit: "EACH", amount: 5 } },
    },
  });

  await dump("update_price foreign SKU", {
    name: "walmart_update_price",
    arguments: {
      payload: {
        Price: {
          itemIdentifier: { sku: "definitely-not-our-sku-zzz", productIdType: "SKU" },
          pricingList: { pricing: [{ currentPrice: { value: { amount: 12.34, currency: "USD" } } }] },
        },
      },
    },
  });

  await dump("retire_item foreign SKU", {
    name: "walmart_retire_item",
    arguments: { sku: "definitely-not-our-sku-zzz" },
  });
} catch (err) {
  console.error("Inspection failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await close();
}
