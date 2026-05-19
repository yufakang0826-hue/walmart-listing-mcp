// Dig into the suspicious "unexpectedly succeeded" responses.
// Diagnostic tool: prints raw responses for write tools so you can see
// exactly what sandbox returned.
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.env.WALMART_SANDBOX !== "true") {
  console.error(
    `Refusing to run: sandbox-only script (writes to Walmart). ` +
    `Set WALMART_SANDBOX=true in .env (currently: ${process.env.WALMART_SANDBOX || "undefined"}).`,
  );
  process.exit(1);
}

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "inspect", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

console.log("=== submit_feed with string payload ===");
const r1 = await client.callTool({
  name: "walmart_submit_feed",
  arguments: {
    feedType: "MP_ITEM",
    payload: "this is not a valid feed",
    contentType: "application/json",
  },
});
console.log("isError:", r1.isError);
console.log("structuredContent:", JSON.stringify(r1.structuredContent, null, 2));
console.log("text:", (r1.content?.[0]?.text || "").slice(0, 400));

console.log("\n=== update_inventory foreign SKU ===");
const r2 = await client.callTool({
  name: "walmart_update_inventory",
  arguments: {
    sku: "definitely-not-our-sku-zzz",
    payload: { sku: "definitely-not-our-sku-zzz", quantity: { unit: "EACH", amount: 5 } },
  },
});
console.log("isError:", r2.isError);
console.log("structuredContent:", JSON.stringify(r2.structuredContent, null, 2));
console.log("text:", (r2.content?.[0]?.text || "").slice(0, 400));

console.log("\n=== update_price foreign SKU ===");
const r3 = await client.callTool({
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
console.log("isError:", r3.isError);
console.log("structuredContent:", JSON.stringify(r3.structuredContent, null, 2));
console.log("text:", (r3.content?.[0]?.text || "").slice(0, 400));

console.log("\n=== retire_item foreign SKU ===");
const r4 = await client.callTool({
  name: "walmart_retire_item",
  arguments: { sku: "definitely-not-our-sku-zzz" },
});
console.log("isError:", r4.isError);
console.log("structuredContent:", JSON.stringify(r4.structuredContent, null, 2));
console.log("text:", (r4.content?.[0]?.text || "").slice(0, 400));

await client.close();
