// Bug A round 2: try filter shapes
import "dotenv/config";
import { authService } from "../dist/service/auth-service.js";
if (process.env.WALMART_SANDBOX !== "true") process.exit(1);

const client = authService.createClient();

async function probe(label, body) {
  try {
    const r = await client.request({ method: "POST", path: "/v3/items/catalog/search", body });
    const arr = Array.isArray(r) ? r : [];
    console.log(`OK   ${label}\n     count=${arr.length}`);
  } catch (err) {
    const d = err && err.details ? JSON.stringify(err.details).slice(0, 200) : String(err.message).slice(0, 200);
    console.log(`ERR  ${label}\n     ${d}`);
  }
}

await probe("filter only — lifecycleStatus", { filter: [{ field: "lifecycleStatus", values: ["ACTIVE"] }] });
await probe("filter only — value singular", { filter: [{ field: "lifecycleStatus", value: "ACTIVE" }] });
await probe("query + filter combined", { query: { field: "sku", values: ["%"] }, filter: [{ field: "lifecycleStatus", values: ["ACTIVE"] }] });
await probe("query + filter, value singular", { query: { field: "sku", values: ["%"] }, filter: [{ field: "lifecycleStatus", value: "ACTIVE" }] });
