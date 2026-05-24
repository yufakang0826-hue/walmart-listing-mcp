// Identify which Walmart Global API market a credential pair belongs to.
//
// Background: Walmart Developer Portal doesn't label which market a
// clientId/secret was issued for. This probe tries the OAuth token call
// with each WM_MARKET value (us/mx/ca/cl) against both sandbox and prod
// base URLs, and reports which combos return a real bearer token.
//
// Usage:
//   WALMART_CLIENT_ID=... WALMART_CLIENT_SECRET=... \
//     node servers/listing-mcp/scripts/probe-which-market.mjs
//
// Or read from .env at repo root.

import "dotenv/config";
import { randomUUID } from "node:crypto";

const clientId = process.env.WALMART_CLIENT_ID;
const clientSecret = process.env.WALMART_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set WALMART_CLIENT_ID and WALMART_CLIENT_SECRET (env or .env).");
  process.exit(1);
}

const bases = {
  sandbox: "https://sandbox.walmartapis.com",
  prod: "https://marketplace.walmartapis.com",
};
const markets = ["us", "mx", "ca", "cl"];

async function tryTokenCall(envName, baseUrl, market) {
  try {
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
    const text = await r.text();
    if (r.ok) {
      const json = JSON.parse(text);
      return { status: r.status, accessToken: json.access_token ? `${json.access_token.slice(0, 12)}...` : null, expiresIn: json.expires_in };
    }
    return { status: r.status, body: text.slice(0, 240) };
  } catch (err) {
    return { status: "ERR", body: String(err.message).slice(0, 240) };
  }
}

const results = [];
for (const [envName, baseUrl] of Object.entries(bases)) {
  for (const market of markets) {
    const r = await tryTokenCall(envName, baseUrl, market);
    const ok = typeof r.status === "number" && r.status >= 200 && r.status < 300;
    console.log(`[${envName.padEnd(7)}] WM_MARKET=${market} → ${r.status} ${ok ? `OK token=${r.accessToken} exp=${r.expiresIn}s` : `(${r.body || "no body"})`}`);
    results.push({ envName, market, ok, status: r.status });
  }
}

console.log("\n##### SUMMARY #####\n");
const winners = results.filter((r) => r.ok);
if (winners.length === 0) {
  console.log("❌ No market accepted the credential. Either:");
  console.log("  - the credential is for a market we didn't test (unlikely — we tried all 4)");
  console.log("  - the clientId/secret is wrong or revoked");
  console.log("  - need WM_CONSUMER.ID or WM_CONSUMER.CHANNEL.TYPE in addition (some MX/CA flows)");
} else {
  console.log(`✅ Credential is valid for ${winners.length} (env, market) combo(s):`);
  for (const w of winners) console.log(`  - env=${w.envName} market=${w.market}`);
  console.log("\nIf only ONE combo worked, that's your market. Use it as the `market` field in walmart_upsert_seller_profile.");
}
