// Probe sandbox SKUs — which SKUs actually look up successfully?
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "probe", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

const list = await client.callTool({ name: "walmart_get_items", arguments: { limit: 20 } });
const items = list.structuredContent?.ItemResponse || [];
console.log(`get_items returned ${items.length} items. Sample first 5 records:`);
for (const item of items.slice(0, 5)) {
  console.log("  ", JSON.stringify({ sku: item.sku, wpid: item.wpid, productName: (item.productName || "").slice(0, 50) }));
}

console.log("\nTrying get_item for each SKU:");
let ok = 0, fail = 0;
const workingSkus = [];
for (const item of items) {
  const sku = item.sku;
  if (!sku) continue;
  const r = await client.callTool({ name: "walmart_get_item", arguments: { sku: String(sku) } });
  const success = r.isError !== true;
  if (success) { ok++; workingSkus.push(sku); }
  else fail++;
  const status = success ? "OK " : "404";
  console.log(`  ${status}  sku=${sku}`);
}
console.log(`\nSummary: ${ok} OK, ${fail} 404`);
if (workingSkus.length > 0) {
  console.log(`\nFirst working SKU: ${workingSkus[0]}`);
}

await client.close();
