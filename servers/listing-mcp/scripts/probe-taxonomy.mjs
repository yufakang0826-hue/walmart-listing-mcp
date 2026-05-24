// Probe Walmart sandbox to find which taxonomy parameters return 200.
// Documents how `version=4.2` was discovered (5.0 / 4.6 / no-version all 400).
import { connectMcp, requireSandbox } from "@walmart-mcp/test-utils";

requireSandbox("queries Walmart taxonomy");

const { client, close } = await connectMcp("probe-taxonomy");

const trials = [
  { feedType: "MP_ITEM", version: "5.0" },
  { feedType: "MP_ITEM", version: "4.6" },
  { feedType: "MP_ITEM", version: "4.2" },
  { feedType: "MP_ITEM" },
  { feedType: "MP_MAINTENANCE", version: "4.2" },
  { feedType: "MP_WFS_ITEM", version: "4.2" },
];

try {
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
} finally {
  await close();
}
