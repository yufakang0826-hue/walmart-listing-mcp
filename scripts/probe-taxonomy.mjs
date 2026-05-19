// Probe Walmart sandbox to find which taxonomy parameters return 200.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "probe", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

const trials = [
  { feedType: "MP_ITEM", version: "5.0" },
  { feedType: "MP_ITEM", version: "4.6" },
  { feedType: "MP_ITEM", version: "4.2" },
  { feedType: "MP_ITEM" },
  { feedType: "MP_MAINTENANCE", version: "4.2" },
  { feedType: "MP_WFS_ITEM", version: "4.2" },
];

for (const args of trials) {
  try {
    const r = await client.callTool({ name: "walmart_get_taxonomy", arguments: args });
    const ok = r.isError !== true;
    const msg = ok
      ? `keys=${Object.keys(r.structuredContent || {}).slice(0, 6).join(",")}`
      : (r.content?.[0]?.text || "").slice(0, 180);
    console.log(`${ok ? "OK " : "ERR"}  ${JSON.stringify(args)} → ${msg}`);
  } catch (err) {
    console.log(`ERR  ${JSON.stringify(args)} → ${String(err).slice(0, 180)}`);
  }
}

await client.close();
