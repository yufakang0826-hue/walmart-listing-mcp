// Structural smoke test for @walmart-mcp/orders-server — no credentials.
// Verifies tool inventory, annotations, strict-schema rejection.

import { connectMcp, createRecorder } from "@walmart-mcp/test-utils";

const EXPECTED_TOOL_NAMES = new Set([
  "walmart_get_orders",
  "walmart_get_order",
  "walmart_acknowledge_order",
  "walmart_ship_order",
  "walmart_cancel_order",
  "walmart_refund_order",
  "walmart_get_returns",
  "walmart_issue_return_refund",
]);

const r = createRecorder();
const { client, close } = await connectMcp("orders-smoke-test");

try {
  r.record("connect", true);

  const list = await client.listTools();
  const got = new Set(list.tools.map((t) => t.name));

  r.record(`tool count is ${EXPECTED_TOOL_NAMES.size}`, got.size === EXPECTED_TOOL_NAMES.size, `actual=${got.size}`);

  const missing = [...EXPECTED_TOOL_NAMES].filter((n) => !got.has(n));
  r.record("all expected tools present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");

  const surprises = [...got].filter((n) => !EXPECTED_TOOL_NAMES.has(n));
  r.record("no unexpected tools", surprises.length === 0, surprises.length ? `extra: ${surprises.join(", ")}` : "");

  // walmart_acknowledge_order should be idempotent + non-destructive
  const ack = list.tools.find((t) => t.name === "walmart_acknowledge_order");
  const ackAnn = ack?.annotations || {};
  r.record(
    "walmart_acknowledge_order annotations correct",
    ackAnn.idempotentHint === true && ackAnn.destructiveHint === false && ackAnn.openWorldHint === true,
    `got ${JSON.stringify(ackAnn)}`,
  );

  // walmart_ship_order should be non-idempotent (records new shipment each call)
  const ship = list.tools.find((t) => t.name === "walmart_ship_order");
  const shipAnn = ship?.annotations || {};
  r.record(
    "walmart_ship_order annotations correct",
    shipAnn.idempotentHint === false && shipAnn.openWorldHint === true,
    `got ${JSON.stringify(shipAnn)}`,
  );

  // Strict schema check: walmart_get_order with extra param should reject
  // either via thrown McpError OR a result with isError=true.
  let strictOk = false;
  let strictDetail = "";
  try {
    const res = await client.callTool({
      name: "walmart_get_order",
      arguments: { purchaseOrderId: "test", nonExistentField: true },
    });
    const text = res?.content?.[0]?.text || "";
    strictOk = res?.isError === true && /nonExistentField|Unrecognized|strict/i.test(text);
    strictDetail = text.slice(0, 160) || "no isError";
  } catch (e) {
    const msg = String(e?.message || e);
    strictOk = /nonExistentField|Unrecognized|strict/i.test(msg);
    strictDetail = msg.slice(0, 160);
  }
  r.record("strict schema rejects unknown field", strictOk, strictDetail);
} finally {
  await close();
}

r.finish();
