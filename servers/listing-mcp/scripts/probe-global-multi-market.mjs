// Verify Walmart Global API multi-market business calls work with a
// single credential. Probes GET /v3/items?limit=1 for each market that
// passed the auth probe.
//
// Usage: node servers/listing-mcp/scripts/probe-global-multi-market.mjs
// Reads .env at repo root for WALMART_CLIENT_ID / WALMART_CLIENT_SECRET.

import "dotenv/config";
import { randomUUID } from "node:crypto";

const clientId = process.env.WALMART_CLIENT_ID;
const clientSecret = process.env.WALMART_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set WALMART_CLIENT_ID and WALMART_CLIENT_SECRET.");
  process.exit(1);
}

const env = process.env.WALMART_SANDBOX === "true" ? "sandbox" : "prod";
const baseUrl = env === "sandbox" ? "https://sandbox.walmartapis.com" : "https://marketplace.walmartapis.com";
const markets = (process.env.WALMART_PROBE_MARKETS || "us,mx,ca").split(",");

console.log(`Probing ${env.toUpperCase()} ${baseUrl} for markets: ${markets.join(", ")}\n`);

async function getToken(market) {
  const r = await fetch(`${baseUrl}/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": randomUUID(),
      "WM_MARKET": market,
      "WM_GLOBAL_VERSION": "3.1",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`token call failed for market=${market}: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function probeItems(market, token) {
  const r = await fetch(`${baseUrl}/v3/items?limit=1`, {
    method: "GET",
    headers: {
      "WM_SEC.ACCESS_TOKEN": token,
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": randomUUID(),
      "WM_MARKET": market,
      "WM_GLOBAL_VERSION": "3.1",
      Accept: "application/json",
    },
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

const findings = [];
for (const market of markets) {
  try {
    const token = await getToken(market);
    const items = await probeItems(market, token);
    const ok = items.status === 200;
    const totalItems = ok ? items.body?.totalItems : null;
    const firstSku = ok ? items.body?.ItemResponse?.[0]?.sku : null;
    const errInfo = !ok ? JSON.stringify(items.body).slice(0, 180) : null;
    console.log(`[${market}] token ✓ items GET → ${items.status}${ok ? ` totalItems=${totalItems} firstSku=${firstSku ?? "(none)"}` : ` err=${errInfo}`}`);
    findings.push({ market, ok, status: items.status, totalItems, firstSku });
  } catch (err) {
    console.log(`[${market}] FAILED: ${String(err.message).slice(0, 180)}`);
    findings.push({ market, ok: false, error: err.message });
  }
}

console.log("\n##### SUMMARY #####\n");
for (const f of findings) {
  if (f.ok) {
    console.log(`✅ ${f.market}: totalItems=${f.totalItems}, firstSku=${f.firstSku ?? "(none)"}`);
  } else {
    console.log(`❌ ${f.market}: ${f.error || `status=${f.status}`}`);
  }
}
