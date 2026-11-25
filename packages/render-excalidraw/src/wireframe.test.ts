import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { exampleNames, renderExample, renderLifecycleSpec, renderScreens } from "../test/scenes.ts";
import type { ArrowElement, ExcalidrawElement, FrameElement } from "./elements.ts";

/** Bounding box; a line's points are relative to (x, y) and may run left or up. */
function bounds(el: ExcalidrawElement) {
  if (el.type !== "line" && el.type !== "arrow")
    return { x: el.x, y: el.y, right: el.x + el.width, bottom: el.y + el.height };
  const xs = el.points.map((p) => el.x + p[0]);
  const ys = el.points.map((p) => el.y + p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

const byId = (elements: ExcalidrawElement[]) => new Map(elements.map((e) => [e.id, e]));
const data = (el: ExcalidrawElement | undefined) =>
  (el?.customData as { groundboard?: Record<string, unknown> } | undefined)?.groundboard;

describe("flow boards keep their scenes", () => {
  test.each(exampleNames)("%s renders exactly the pinned scene", async (name) => {
    const pinned = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "..", "test", "pinned", `${name}.excalidraw.json`),
        "utf8",
      ),
    );
    const { scene } = await renderExample(name);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(pinned);
  });
});

describe("spec-stage wireframes", () => {
  test("spec tags and marks lie inside the screen's frame", async () => {
    const { scene } = await renderLifecycleSpec("web--signup");
    const els = byId(scene.elements);
    const inFrames = scene.elements.filter((e) => e.frameId === "node/signup");
    expect(inFrames.some((e) => e.id.endsWith("/spec"))).toBe(true);
    const frame = els.get("node/signup") as FrameElement;
    for (const el of inFrames) {
      const box = bounds(el);
      expect(box.x, el.id).toBeGreaterThanOrEqual(frame.x);
      expect(box.y, el.id).toBeGreaterThanOrEqual(frame.y);
      expect(box.right, el.id).toBeLessThanOrEqual(frame.x + frame.width + 0.01);
      expect(box.bottom, el.id).toBeLessThanOrEqual(frame.y + frame.height + 0.01);
    }
  });
});

describe("screen wireframes", () => {
  test("every element, its text and its marks lie inside the screen's frame", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    const inFrames = scene.elements.filter((e) => e.frameId?.startsWith("node/"));
    expect(inFrames.length).toBeGreaterThan(20);
    for (const el of inFrames) {
      const frame = els.get(el.frameId as string) as FrameElement;
      expect(frame.type).toBe("frame");
      const box = bounds(el);
      expect(box.x, el.id).toBeGreaterThanOrEqual(frame.x);
      expect(box.y, el.id).toBeGreaterThanOrEqual(frame.y);
      expect(box.right, el.id).toBeLessThanOrEqual(frame.x + frame.width + 0.01);
      expect(box.bottom, el.id).toBeLessThanOrEqual(frame.y + frame.height + 0.01);
    }
    // Every element of the board, and every text bound to one, has its frame.
    for (const id of ["pay", "number", "terms", "back", "logo", "title"]) {
      expect(els.get(`node/${id}`)?.frameId).toBe("node/checkout");
    }
    expect(els.get("label/pay")?.frameId).toBe("node/checkout");
  });

  test("puts each frame after its children and uses no group ids", async () => {
    const { scene } = await renderScreens();
    const index = new Map(scene.elements.map((e, i) => [e.id, i]));
    for (const el of scene.elements) {
      if (el.frameId?.startsWith("node/")) {
        expect(index.get(el.id) as number, el.id).toBeLessThan(index.get(el.frameId) as number);
      }
      if (el.frameId?.startsWith("node/") || el.type === "frame")
        expect(el.groupIds, el.id).toEqual([]);
    }
  });

  test("names frames with their layout origin and draws a numbered tag for toRef, no chip", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    expect((els.get("node/checkout") as FrameElement).name).toBe("Checkout · from Figma");
    expect(els.get("node/@ref:web:cart")).toBeUndefined();
    expect(els.get("edge/back-cart")).toBeUndefined();
    const tag = els.get("ref-tag/back-cart");
    expect(tag?.type).toBe("rectangle");
    expect(tag?.strokeStyle).toBe("dashed");
    expect((els.get("ref-tag/back-cart/number") as { text: string }).text).toBe("1");
    expect((els.get("ref-line/back-cart") as { text: string }).text).toBe("1 → web:cart");
    // The tag sits on the top-right corner of its element; the line lies right of the frame.
    const back = els.get("node/back") as ExcalidrawElement;
    const frame = els.get("node/checkout") as ExcalidrawElement;
    expect(tag?.x).toBeLessThan(back.x + back.width + 8);
    expect((tag?.x ?? 0) + (tag?.width ?? 0)).toBeGreaterThan(back.x + back.width);
    expect((tag?.y ?? 0) + (tag?.height ?? 0)).toBeGreaterThan(back.y);
    expect(tag?.y).toBeLessThan(back.y);
    expect(els.get("ref-line/back-cart")?.x).toBeGreaterThan(frame.x + frame.width);
  });

  test("draws a screen with no elements as a box holding only its label", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    const done = els.get("node/done");
    expect(done?.type).toBe("rectangle");
    expect(done?.frameId).toBeNull();
    expect(data(done)).toMatchObject({ nodeId: "done", kind: "screen", ref: "web:order-placed" });
    const label = scene.elements.find(
      (e) => e.type === "text" && (e as { containerId?: string }).containerId === "node/done",
    ) as { text: string } | undefined;
    expect(label?.text).toBe("Order placed");
    expect(scene.elements.some((e) => e.frameId === "node/done")).toBe(false);
  });

  test("carries ref, role, action, unresolved and Figma sources in customData", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    expect(data(els.get("node/pay"))).toMatchObject({
      nodeId: "pay",
      kind: "element",
      ref: "web:checkout/pay-button",
      role: "button",
      action: "submits the order",
    });
    expect(data(els.get("node/number"))).toMatchObject({
      unresolved: "No handler found (Frontend)",
    });
    expect(els.get("node/number/unresolved")).toBeDefined();
    expect(els.get("node/pay/action")).toBeDefined();
    expect(data(els.get("node/checkout"))).toMatchObject({
      layoutFrom: "figma",
      platform: "web",
      sources: [
        { id: "route", path: "examples/fixtures/checkout/cart.ts", line: 1, quote: "x" },
        {
          id: "fig",
          kind: "figma",
          fileKey: "AbCdEf0123456789",
          nodeId: "12:34",
          url: "https://www.figma.com/design/AbCdEf0123456789?node-id=12-34",
        },
      ],
    });
  });

  test("navigates arrows carry their sources and bind to both ends", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    const toDone = els.get("edge/pay-done") as ArrowElement;
    expect(toDone.strokeColor).toBe("#e03131");
    expect(data(toDone)).toMatchObject({ edgeId: "pay-done", kind: "navigates" });
    expect(toDone.startBinding?.elementId).toBe("node/pay");
    expect(toDone.endBinding?.elementId).toBe("node/done");
    expect(data(els.get("edge/terms-pay"))).toEqual({ edgeId: "terms-pay", kind: "relates" });
  });

  test("the tag and the list line of a toRef edge carry its data and share one group", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    const parts = ["ref-tag/back-cart", "ref-tag/back-cart/number", "ref-line/back-cart"].map(
      (id) => els.get(id) as ExcalidrawElement,
    );
    for (const part of parts) {
      expect(part.strokeColor).toBe("#e03131");
      expect(part.groupIds).toEqual(["ref-back-cart"]);
      expect(part.frameId).toBeNull();
      expect(data(part)).toEqual({
        edgeId: "back-cart",
        from: "back",
        kind: "navigates",
        toRef: "web:cart",
        sources: [
          { id: "back-handler", path: "examples/fixtures/checkout/cart.ts", line: 3, quote: "x" },
        ],
        grounding: "code",
      });
    }
  });

  test("counts Figma sources in the title and lists only present wireframe parts", async () => {
    const { scene } = await renderScreens();
    const els = byId(scene.elements);
    expect((els.get("title-figma") as { text: string }).text).toBe("1 Figma source not checked");
    const legend = scene.elements.filter((e) => e.id.startsWith("legend-label/")).map((e) => e.id);
    expect(legend).toEqual([
      "legend-label/element-action",
      "legend-label/element-unresolved",
      "legend-label/ref-marker",
      "legend-label/navigates",
    ]);
  });
});
