import { layoutBoard } from "@groundboard/layout";
import { type Board, parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { sequenceBoard } from "../../schema/test/sequence-board.ts";
import type { ArrowElement, ExcalidrawElement, TextElement } from "./elements.ts";
import { renderExcalidraw } from "./render.ts";

function parse(raw: unknown): Board {
  const result = parseBoard(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function render(raw: unknown = sequenceBoard()) {
  const board = parse(raw);
  return renderExcalidraw(await layoutBoard(board), board);
}

const data = (el: ExcalidrawElement | undefined) =>
  el?.customData?.groundboard as Record<string, unknown> | undefined;

describe("a sequence board's scene", () => {
  test("draws each participant once, with its category, and a locked lifeline under it", async () => {
    const scene = await render();
    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    for (const id of ["user", "api", "bank", "db", "q"]) {
      expect(byId.get(`node/${id}`)?.type, id).toBe("rectangle");
      const lifeline = byId.get(`lifeline/${id}`);
      expect(lifeline?.type).toBe("line");
      expect(lifeline?.locked).toBe(true);
      expect(lifeline?.customData).toBeUndefined();
      expect(lifeline?.strokeStyle).toBe("dashed");
    }
    expect(data(byId.get("node/bank"))).toMatchObject({
      nodeId: "bank",
      kind: "participant",
      category: "external",
      sources: [{ id: "gw" }],
      grounding: "code",
    });
    expect(byId.get("node/bank")?.strokeStyle).toBe("dashed");
    expect((byId.get("node/bank/caption") as TextElement).text).toBe("external");
    // Each category has its own mark: a figure, a cylinder's arcs, a queue's bars.
    expect(byId.get("node/user/head")?.type).toBe("ellipse");
    expect(byId.get("node/user")?.strokeColor).toBe("transparent");
    expect(byId.get("node/db/rim")?.type).toBe("ellipse");
    expect(byId.get("node/db/base")?.type).toBe("ellipse");
    expect(byId.get("node/q/bar3")?.type).toBe("line");
    expect(data(byId.get("node/api"))).toMatchObject({ ref: "api:orders/post" });
  });

  test("draws a call solid with a filled head, a reply dashed, an async message with an open head", async () => {
    const scene = await render();
    const arrows = scene.elements.filter((e): e is ArrowElement => e.type === "arrow");
    const message = (id: string) => arrows.find((a) => a.id === `edge/${id}`) as ArrowElement;
    expect(arrows.filter((a) => a.id.startsWith("edge/"))).toHaveLength(7);
    expect(message("m2")).toMatchObject({ strokeStyle: "solid", endArrowhead: "triangle" });
    expect(message("m3")).toMatchObject({ strokeStyle: "dashed", endArrowhead: "arrow" });
    expect(message("m6")).toMatchObject({ strokeStyle: "solid", endArrowhead: "arrow" });
    expect(message("m2").startBinding).toBeNull();
    const label = scene.elements.find((e) => e.id === "edge-label/m6") as TextElement;
    expect(label.text).toBe("6. send-receipt (async)");
    expect(data(message("m4"))).toMatchObject({
      edgeId: "m4",
      kind: "message",
      number: 4,
      messageType: "sync",
      from: "api",
      to: "db",
      ref: "db:orders",
      sources: [{ id: "insert" }],
    });
    expect(data(label)).toEqual(data(message("m6")));
  });

  test("frames each fragment with its kind, its guards and a divider between operands", async () => {
    const scene = await render();
    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    expect(byId.get("fragment/pay")?.type).toBe("rectangle");
    expect(byId.get("fragment/lines")?.type).toBe("rectangle");
    expect((byId.get("fragment-tag/pay/text") as TextElement).text).toBe("alt");
    expect((byId.get("fragment-tag/lines/text") as TextElement).text).toBe("loop");
    // One divider per operand after the first.
    expect(scene.elements.filter((e) => e.id.startsWith("operand-line/")).map((e) => e.id)).toEqual(
      ["operand-line/declined"],
    );
    expect((byId.get("operand-guard/ok") as TextElement).text).toBe("[authorized]");
    expect(data(byId.get("operand-guard/declined"))).toMatchObject({
      kind: "operand",
      fragmentId: "pay",
      operandId: "declined",
      fragmentKind: "alt",
      guard: "declined",
      sources: [{ id: "if-ok" }],
      grounding: "code",
    });
    // The frame and its tag select the fragment by its first operand.
    expect(data(byId.get("fragment-tag/pay"))).toMatchObject({ operandId: "ok" });
    expect(data(byId.get("fragment/lines"))).toMatchObject({ operandId: "each" });
    // Fragments are drawn before messages, so a message lies on top.
    const order = scene.elements.map((e) => e.id);
    expect(order.indexOf("fragment/pay")).toBeLessThan(order.indexOf("fragment/lines"));
    expect(order.indexOf("fragment/lines")).toBeLessThan(order.indexOf("edge/m5"));
  });

  test("every part a reader can select carries the data of what it stands for", async () => {
    const scene = await render();
    const ids = scene.elements.map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const el of scene.elements) {
      if (
        el.id.startsWith("lifeline/") ||
        el.id.startsWith("title") ||
        el.id.startsWith("legend")
      ) {
        continue;
      }
      if (el.frameId === "legend") continue;
      const d = data(el);
      expect(
        d?.nodeId ?? d?.edgeId ?? d?.operandId,
        `${el.id} carries no node, edge or operand`,
      ).toBeDefined();
    }
  });

  test("lists the participant categories and message types in the legend, not the flow kinds", async () => {
    const scene = await render();
    const legend = scene.elements
      .filter((e): e is TextElement => e.type === "text" && e.frameId === "legend")
      .map((e) => e.text);
    for (const label of [
      "person",
      "system (ours)",
      "external service",
      "database",
      "queue",
      "call, waits for the answer",
      "reply",
      "message, does not wait (async)",
    ]) {
      expect(legend).toContain(label);
    }
    expect(legend).not.toContain("decision");
  });

  test("marks a manual message dotted with a tag, and is the same twice", async () => {
    const raw = sequenceBoard();
    Object.assign(raw.edges[1] as object, { manual: true, sourceIds: [] });
    const scene = await render(raw);
    const m2 = scene.elements.find((e) => e.id === "edge/m2");
    expect(m2?.strokeStyle).toBe("dotted");
    expect((scene.elements.find((e) => e.id === "edge/m2/spec") as TextElement).text).toBe(
      "manual",
    );
    expect(JSON.stringify(await render(raw))).toBe(JSON.stringify(scene));
  });
});
