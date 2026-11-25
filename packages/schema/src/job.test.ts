import { describe, expect, test } from "vitest";
import { boardKindOf, refsOf } from "./atlas-shape.ts";
import { boardClaims } from "./grounding.ts";
import { lintBoardText } from "./lint-text.ts";
import { parseBoard } from "./validate.ts";

const source = { id: "j", path: "server/jobs.ts", line: 1, quote: "worker(...)" };
const job = (extra: Record<string, unknown>) => ({
  id: "send-receipt",
  kind: "job",
  label: "Send the receipt",
  ref: "batch:send-receipt",
  sourceIds: ["j"],
  trigger: { type: "queue", queue: "receipts" },
  ...extra,
});
const board = (nodes: unknown[], edges: unknown[] = []) => ({
  schemaVersion: 1,
  title: "Jobs",
  question: "Which jobs?",
  nodes,
  edges,
  sources: [source],
});
const messages = (input: unknown) => {
  const result = parseBoard(input);
  return result.ok ? [] : result.error.map((i) => `${i.path}: ${i.message}`);
};

describe("jobs", () => {
  test("a job with a trigger and retries is valid, a batch board, and defines its ref", () => {
    const parsed = parseBoard(
      board([job({ retry: { attempts: 3, backoff: "exponential" }, timeout: "30s" })]),
    );
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(boardKindOf(parsed.value)).toBe("batch");
    expect(refsOf(parsed.value).defined.map((d) => d.ref)).toEqual(["batch:send-receipt"]);
    expect(boardClaims(parsed.value).map((c) => [c.id, c.grounding])).toEqual([
      ["send-receipt", "code"],
    ]);
  });

  test("each trigger type needs its own field and no other", () => {
    expect(messages(board([job({ trigger: { type: "queue" } })]))).toEqual([
      "nodes[0].trigger.queue: job `send-receipt` has a queue trigger, so it needs trigger.queue",
    ]);
    expect(
      messages(board([job({ trigger: { type: "manual", schedule: "0 2 * * *" } })])).join(" "),
    ).toContain("trigger.schedule belongs to a cron trigger");
    expect(messages(board([job({ trigger: undefined })])).join(" ")).toContain("needs a trigger");
  });

  test("a cron schedule has 5 or 6 fields of cron characters", () => {
    expect(parseBoard(board([job({ trigger: { type: "cron", schedule: "0 2 * * *" } })])).ok).toBe(
      true,
    );
    expect(
      parseBoard(board([job({ trigger: { type: "cron", schedule: "*/15 0-6 * * MON-FRI" } })])).ok,
    ).toBe(true);
    for (const schedule of ["every day", "0 2 * *", "0 2 * * * * *", "0 2 * * ; rm"]) {
      expect(
        messages(board([job({ trigger: { type: "cron", schedule } })])).join(" "),
        schedule,
      ).toContain("is not a cron expression");
    }
  });

  test("a batch ref has no second part, and trigger fields belong to jobs only", () => {
    expect(messages(board([job({ ref: "batch:send-receipt/step" })])).join(" ")).toContain(
      "a job ref is `batch:<job>`, with no second part",
    );
    const step = {
      id: "s",
      kind: "step",
      label: "Step",
      sourceIds: ["j"],
      trigger: { type: "manual" },
    };
    expect(messages(board([job({}), step])).join(" ")).toContain(
      "trigger is only allowed on `job` nodes",
    );
  });

  test("an endpoint, a step or a job enqueues a job, citing where; a job may read a table", () => {
    const step = { id: "s", kind: "step", label: "Place", sourceIds: ["j"] };
    const ok = board(
      [job({}), step],
      [
        { id: "e", from: "s", to: "send-receipt", kind: "enqueues", sourceIds: ["j"] },
        { id: "r", from: "send-receipt", toRef: "db:orders", kind: "reads", sourceIds: ["j"] },
      ],
    );
    expect(parseBoard(ok).ok, JSON.stringify(parseBoard(ok))).toBe(true);
    expect(
      messages(
        board([job({}), step], [{ id: "e", from: "s", to: "send-receipt", kind: "enqueues" }]),
      ).join(" "),
    ).toContain("enqueues edge `e` cites no source");
    expect(
      messages(
        board(
          [job({}), step],
          [{ id: "e", from: "s", toRef: "db:orders", kind: "enqueues", sourceIds: ["j"] }],
        ),
      ).join(" "),
    ).toContain("is in namespace db; enqueues targets a ref");
  });

  test("a queue name that looks like a secret is a warning", () => {
    const parsed = parseBoard(
      board([
        job({ trigger: { type: "queue", queue: "amqp://guest:hunter2@mq.internal/receipts" } }),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(lintBoardText(parsed.value).join(" ")).toContain("a URL with a password");
  });
});
