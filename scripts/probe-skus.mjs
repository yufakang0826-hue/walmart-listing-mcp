// Probe sandbox SKUs — which SKUs actually look up successfully?
// Sandbox-only: this script issues ~21 read calls against whatever account
// the env points at. In production those would be other sellers' SKUs.
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.env.WALMART_SANDBOX !== "true") {
  console.error(
    `Refusing to run: sandbox-only script (queries arbitrary SKUs). ` +
    `Set WALMART_SANDBOX=true in .env (currently: ${process.env.WALMART_SANDBOX || "undefined"}).`,
  );
  process.exit(1);
}

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "probe", version: "0.0.1" }, { capabilities: {} });

try {
  await client.connect(transport);

  const list = await client.callTool({ name: "walmart_get_items", arguments: { limit: 20 } });
  const items = list.structuredContent?.ItemResponse || [];
  console.log(`get_items returned ${items.length} items. Sample first 5 records:`);
  for (const item of items.slice(0, 5)) {
    console.log("  ", JSON.stringify({ sku: item.sku, wpid: item.wpid, productName: (item.productName || "").slice(0, 50) }));
  }

  console.log("\nTrying get_item for each SKU:");
  let ok = 0, fail = 0, errors = 0;
  const workingSkus = [];
  for (const item of items) {
    const sku = item.sku;
    if (!sku) continue;
    try {
      const r = await client.callTool({ name: "walmart_get_item", arguments: { sku: String(sku) } });
      const success = r.isError !== true;
      if (success) { ok++; workingSkus.push(sku); }
      else fail++;
      console.log(`  ${success ? "OK " : "404"}  sku=${sku}`);
    } catch (err) {
      errors++;
      console.log(`  ERR sku=${sku} — ${String(err).slice(0, 120)}`);
    }
    // Gentle pacing to avoid tripping Walmart sandbox rate limits.
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\nSummary: ${ok} OK, ${fail} 404, ${errors} errored`);
  if (workingSkus.length > 0) {
    console.log(`\nFirst working SKU: ${workingSkus[0]}`);
  }
} catch (err) {
  console.error("Probe failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
