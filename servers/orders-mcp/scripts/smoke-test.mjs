// Structural smoke test for @walmart-mcp/orders-server — no credentials.
// Verifies tool inventory, annotations, strict-schema rejection.

import { connectMcp, createRecorder } from "@walmart-mcp/test-utils";

const EXPECTED_TOOL_NAMES = new Set([
  "walmart_list_orders",
  "walmart_list_released_orders",
  "walmart_get_order",
  "walmart_acknowledge_order",
  "walmart_acknowledge_orders_bulk",
  "walmart_ship_order_lines",
  "walmart_cancel_order_lines",
  "walmart_refund_order_lines",
  "walmart_list_returns",
  "walmart_get_return",
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

  // walmart_acknowledge_order — idempotent + non-destructive
  const ack = list.tools.find((t) => t.name === "walmart_acknowledge_order");
  const ackAnn = ack?.annotations || {};
  r.record(
    "walmart_acknowledge_order annotations correct",
    ackAnn.idempotentHint === true && ackAnn.destructiveHint === false && ackAnn.openWorldHint === true,
    `got ${JSON.stringify(ackAnn)}`,
  );

  // walmart_ship_order_lines — non-idempotent (records new shipment each call)
  const ship = list.tools.find((t) => t.name === "walmart_ship_order_lines");
  const shipAnn = ship?.annotations || {};
  r.record(
    "walmart_ship_order_lines annotations correct",
    shipAnn.idempotentHint === false && shipAnn.openWorldHint === true,
    `got ${JSON.stringify(shipAnn)}`,
  );

  // walmart_refund_order_lines — non-idempotent (each call creates refund record)
  const refund = list.tools.find((t) => t.name === "walmart_refund_order_lines");
  const refundAnn = refund?.annotations || {};
  r.record(
    "walmart_refund_order_lines annotations correct",
    refundAnn.idempotentHint === false && refundAnn.openWorldHint === true,
    `got ${JSON.stringify(refundAnn)}`,
  );

  // Strict schema check: walmart_get_order with extra param should reject
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
