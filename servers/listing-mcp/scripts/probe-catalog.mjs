// Probe the Walmart catalog search endpoint to discover the real response shape.
// Sandbox-only — this is a diagnostic script.
import { connectMcp, requireSandbox } from "@walmart-mcp/test-utils";

requireSandbox("queries Walmart public catalog");

// Temporary inline ad-hoc client until we wire the tool; we go through the
// raw client object exposed via the MCP layer.
const { client, close } = await connectMcp("probe-catalog");

const trials = [
  { label: "query=ipad", args: { query: "ipad" } },
  { label: "gtin=00193514013203", args: { gtin: "00193514013203" } },
  { label: "upc=193514013203", args: { upc: "193514013203" } },
  { label: "responseFormat=SPEC + query=ipad", args: { query: "ipad", responseFormat: "SPEC" } },
];

try {
  for (const { label, args } of trials) {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await client.callTool({ name: "walmart_search_walmart_catalog", arguments: args });
      console.log("isError:", r.isError);
      if (r.isError) {
        console.log("error text:", (r.content?.[0]?.text || "").slice(0, 300));
      } else {
        const sc = r.structuredContent;
        console.log("structuredContent keys:", Object.keys(sc || {}));
        if (sc && typeof sc === "object") {
          // Print a structural summary without dumping everything
          for (const [k, v] of Object.entries(sc)) {
            if (Array.isArray(v)) {
              console.log(`  ${k}: Array(${v.length})${v.length ? ", first item keys=" + Object.keys(v[0] || {}).slice(0, 10).join(",") : ""}`);
            } else if (typeof v === "object" && v !== null) {
              console.log(`  ${k}: Object{${Object.keys(v).slice(0, 10).join(",")}}`);
            } else {
              console.log(`  ${k}:`, JSON.stringify(v).slice(0, 80));
            }
          }
        }
      }
    } catch (err) {
      console.log("THROWN:", err instanceof Error ? err.message : String(err));
    }
  }
} finally {
  await close();
}
