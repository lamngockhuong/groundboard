// A sequence board for tests: the handler of POST /api/orders, which asks a payment gateway to
// authorize the amount, then in an alt either stores the order (a loop stores each line) and
// enqueues the receipt, or answers 402. Raw JSON, so each test can break one rule.

export const code = (id: string, line: number, quote: string) => ({
  id,
  path: "server/orders-routes.ts",
  line,
  quote,
});

/** The handler of POST /api/orders as a sequence: an alt of authorized and declined, a loop inside. */
export function sequenceBoard() {
  return {
    schemaVersion: 1,
    title: "Placing an order",
    question: "What does POST /api/orders do?",
    nodes: [
      { id: "user", kind: "participant", category: "person", label: "Customer" },
      {
        id: "api",
        kind: "participant",
        category: "system",
        label: "Orders API",
        ref: "api:orders/post",
        sourceIds: ["route"],
      },
      {
        id: "bank",
        kind: "participant",
        category: "external",
        label: "Payment gateway",
        sourceIds: ["gw"],
      },
      { id: "db", kind: "participant", category: "database", label: "Database", sourceIds: ["db"] },
      {
        id: "q",
        kind: "participant",
        category: "queue",
        label: "Job queue",
        ref: "batch:send-receipt",
        sourceIds: ["queue"],
      },
    ] as Array<Record<string, unknown>>,
    edges: [
      {
        id: "m1",
        kind: "message",
        from: "user",
        to: "api",
        label: "POST /api/orders",
        ref: "api:orders/post",
        sourceIds: ["route"],
      },
      {
        id: "m2",
        kind: "message",
        from: "api",
        to: "bank",
        label: "authorize(amount)",
        sourceIds: ["auth"],
      },
      {
        id: "m3",
        kind: "message",
        messageType: "reply",
        from: "bank",
        to: "api",
        label: "authorization id",
        sourceIds: ["auth"],
      },
      {
        id: "m4",
        kind: "message",
        from: "api",
        to: "db",
        label: "insert order",
        ref: "db:orders",
        operandId: "ok",
        sourceIds: ["insert"],
      },
      {
        id: "m5",
        kind: "message",
        from: "api",
        to: "db",
        label: "insert line",
        ref: "db:order-items",
        operandId: "each",
        sourceIds: ["line"],
      },
      {
        id: "m6",
        kind: "message",
        messageType: "async",
        from: "api",
        to: "q",
        label: "send-receipt",
        operandId: "ok",
        sourceIds: ["enqueue"],
      },
      {
        id: "m7",
        kind: "message",
        messageType: "reply",
        from: "api",
        to: "user",
        label: "402 declined",
        operandId: "declined",
        sourceIds: ["decline"],
      },
    ] as Array<Record<string, unknown>>,
    fragments: [
      {
        id: "pay",
        kind: "alt",
        operands: [
          { id: "ok", guard: "authorized", sourceIds: ["if-ok"] },
          { id: "declined", guard: "declined", sourceIds: ["if-ok"] },
        ],
      },
      {
        id: "lines",
        kind: "loop",
        parentOperandId: "ok",
        operands: [{ id: "each", guard: "each cart line", sourceIds: ["for"] }],
      },
    ] as Array<Record<string, unknown>>,
    sources: [
      code("route", 10, 'router.post("/orders"'),
      code("gw", 5, "import { gateway }"),
      code("db", 4, "import { db }"),
      code("queue", 6, "import { queue }"),
      code("auth", 11, "await gateway.authorize"),
      code("if-ok", 12, "if (!authorized)"),
      code("insert", 15, 'db.insert("orders"'),
      code("for", 16, "for (const line of"),
      code("line", 17, 'db.insert("order_items"'),
      code("enqueue", 19, 'queue.add("send-receipt"'),
      code("decline", 13, "res.status(402)"),
    ],
  };
}
