// @vitest-environment jsdom
//
// Loads our scenes through Excalidraw's own `restoreElements`, the function every loader runs
// (file open, `initialData`), in the version the viewer ships (0.18.1) and in the pinned `next`
// build whose binding format excalidraw.com runs. The scene must survive unchanged: nothing
// dropped, no binding repaired, no text resized.

import { beforeAll, describe, expect, test } from "vitest";
import type { ExcalidrawElement, TextElement } from "../src/elements.ts";
import { exampleNames, renderExample, renderLifecycleSpec, renderScreens } from "./scenes.ts";

type Restore = (
  elements: readonly unknown[],
  local: null,
  opts?: {
    refreshDimensions?: boolean;
    repairBindings?: boolean;
    deleteInvisibleElements?: boolean;
  },
) => Array<Record<string, unknown>>;

beforeAll(() => {
  // Excalidraw touches canvas and fonts at import time; jsdom lacks both.
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  proto.getContext = () => ({
    measureText: (t: string) => ({ width: t.length * 8 }),
    font: "",
  });
  if (!("FontFace" in globalThis)) {
    (globalThis as Record<string, unknown>).FontFace = class {
      load() {
        return Promise.resolve(this);
      }
    };
  }
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", {
      value: {
        add() {},
        check: () => true,
        load: () => Promise.resolve([]),
        ready: Promise.resolve(),
      },
    });
  }
});

const oracles: Array<{ name: string; load: () => Promise<Restore> }> = [
  {
    name: "@excalidraw/excalidraw 0.18.1",
    load: async () =>
      (await import("@excalidraw/excalidraw")).restoreElements as unknown as Restore,
  },
  {
    name: "@excalidraw/excalidraw next (0.18.0-9fbeaed, @excalidraw/element 0.18.0-9fbeaed)",
    load: async () => (await import("excalidraw-next")).restoreElements as unknown as Restore,
  },
];

const pick = (b: unknown, keys: string[]) =>
  b && typeof b === "object"
    ? Object.fromEntries(keys.map((k) => [k, (b as Record<string, unknown>)[k]]))
    : b;

const scenes = [
  ...exampleNames.map((name) => ({ name, render: () => renderExample(name) })),
  { name: "screen wireframe", render: renderScreens },
  { name: "spec-stage overview", render: () => renderLifecycleSpec("overview-web") },
  { name: "spec-stage screen", render: () => renderLifecycleSpec("web--signup") },
];

describe.each(oracles)("restoreElements in $name", ({ load }) => {
  test.each(scenes)("$name survives restore unchanged", async ({ render }) => {
    const restore = await load();
    expect(typeof restore).toBe("function");
    const { scene, laidOut } = await render();
    const restored = restore(scene.elements, null, {
      repairBindings: true,
      refreshDimensions: false,
      deleteInvisibleElements: true,
    });
    const after = new Map(restored.map((e) => [e.id as string, e]));

    // Nothing dropped or added.
    expect([...after.keys()].sort()).toEqual(scene.elements.map((e) => e.id).sort());

    for (const el of scene.elements as ExcalidrawElement[]) {
      const r = after.get(el.id) as Record<string, unknown>;
      expect(r.isDeleted, el.id).toBe(false);
      expect(r.type, el.id).toBe(el.type);
      expect(r.frameId ?? null, `${el.id} frameId`).toBe(el.frameId);
      expect(r.groupIds, `${el.id} groupIds`).toEqual(el.groupIds);
      const refs = (r.boundElements as unknown[] | null) ?? [];
      expect(refs, `${el.id} boundElements`).toEqual(
        expect.arrayContaining(el.boundElements ?? []),
      );
      expect(refs.length, `${el.id} boundElements`).toBe((el.boundElements ?? []).length);

      if (el.type === "text") {
        // No text resized or moved.
        expect(pick(r, ["x", "y", "width", "height", "text", "containerId"]), el.id).toEqual(
          pick(el, ["x", "y", "width", "height", "text", "containerId"]),
        );
      }
      if (el.type === "arrow") {
        // No binding repaired: target and attachment survive.
        for (const key of ["startBinding", "endBinding"] as const) {
          const ours = el[key];
          const theirs = r[key] as Record<string, unknown> | null;
          expect(theirs, `${el.id} ${key}`).not.toBeNull();
          expect(theirs?.elementId, `${el.id} ${key}`).toBe(ours?.elementId);
          if ("mode" in (theirs ?? {})) {
            expect(theirs?.mode).toBe("orbit");
            expect(theirs?.fixedPoint).toEqual(ours?.fixedPoint);
          } else {
            expect(pick(theirs, ["focus", "gap"])).toEqual(pick(ours, ["focus", "gap"]));
          }
        }
        expect(r.points, `${el.id} points`).toEqual(el.points);
      }
    }

    // Each node's drawn text equals its laid-out text.
    for (const node of laidOut.nodes) {
      if (node.text === "") continue; // an empty screen with no citation draws no text
      const t = (after.get(`label/${node.id}`) ??
        after.get(`node/${node.id}`)) as unknown as TextElement;
      expect(t.text).toBe(node.text);
    }
  });
});
