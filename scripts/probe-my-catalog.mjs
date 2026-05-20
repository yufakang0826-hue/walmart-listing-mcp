import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") { process.exit(1); }

const client = authService.createClient();

const variants = [
  ["sku %", { query: { values: ["%"], field: "sku" } }],
  ["sku % + filter ACTIVE", { query: { values: ["%"], field: "sku" }, filter: [{ field: "lifecycleStatus", values: ["ACTIVE"] }] }],
  ["sku % + sort", { query: { values: ["%"], field: "sku" }, sort: [{ field: "publishedStatus", order: "DESC" }] }],
  ["productName keurig", { query: { values: ["keurig"], field: "productName" } }],
];

for (const [label, body] of variants) {
  try {
    const r = await client.request({ method: "POST", path: "/v3/items/catalog/search", body });
    const arr = Array.isArray(r) ? r : [];
    console.log(`OK   ${label}\n     count=${arr.length} ${arr[0] ? `first.keys=${Object.keys(arr[0]).slice(0, 8).join(",")}` : ""}`);
  } catch (err) {
    const d = err && err.details ? JSON.stringify(err.details).slice(0, 200) : String(err.message).slice(0, 200);
    console.log(`ERR  ${label}\n     ${d}`);
  }
}
