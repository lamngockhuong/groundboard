import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sceneVersion, useCanvasChanges } from "../src/use-canvas-changes.ts";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "NEVER" } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Element = { id: string; version: number; x: number };

/** The few calls of Excalidraw's API the hook makes, over a scene the test changes by hand. */
function fakeApi(elements: Element[]) {
  return {
    elements,
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: vi.fn(),
    history: { clear: vi.fn() },
  };
}

let root: Root;
let container: HTMLElement;
let latest: ReturnType<typeof useCanvasChanges>;

function Probe({ api, tracking }: { api: ReturnType<typeof fakeApi>; tracking: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  latest = useCanvasChanges(api as never, ref, tracking);
  return createElement(
    "div",
    { ref },
    createElement("div", { className: "excalidraw" }, createElement("canvas")),
    createElement("button", { type: "button", className: "panel" }),
  );
}

function mount(api: ReturnType<typeof fakeApi>, tracking = true) {
  act(() => root.render(createElement(Probe, { api, tracking })));
}

function press(selector: string) {
  const target = container.querySelector(selector) as HTMLElement;
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

/** Excalidraw changing an element in place, as it does, then calling onChange. */
function move(api: ReturnType<typeof fakeApi>) {
  const first = api.elements[0] as Element;
  first.x += 10;
  first.version += 1;
  act(() => latest.check(api.elements as never));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("sceneVersion", () => {
  it("adds up the versions, so any change or new element raises it", () => {
    expect(sceneVersion([{ version: 2 }, { version: 3 }])).toBe(5);
    expect(sceneVersion([])).toBe(0);
  });
});

describe("useCanvasChanges", () => {
  it("counts a change that follows a pointer on the canvas", () => {
    const api = fakeApi([{ id: "a", version: 1, x: 0 }]);
    mount(api);
    press("canvas");
    move(api);
    expect(latest.unsaved).toBe(true);
  });

  it("ignores a click that changes nothing, such as selecting a node", () => {
    const api = fakeApi([{ id: "a", version: 1, x: 0 }]);
    mount(api);
    press("canvas");
    act(() => latest.check(api.elements as never));
    expect(latest.unsaved).toBe(false);
  });

  it("ignores the viewer's own changes: no pointer, or one on a panel over the canvas", () => {
    const api = fakeApi([{ id: "a", version: 1, x: 0 }]);
    mount(api);
    move(api);
    press(".panel");
    move(api);
    expect(latest.unsaved).toBe(false);
  });

  it("counts nothing, and forgets the changes, while editing or presenting", () => {
    const api = fakeApi([{ id: "a", version: 1, x: 0 }]);
    mount(api);
    press("canvas");
    move(api);
    mount(api, false);
    expect(latest.unsaved).toBe(false);
    press("canvas");
    move(api);
    expect(latest.unsaved).toBe(false);
  });

  it("puts back the scene from before the first change and clears Excalidraw's undo", () => {
    const api = fakeApi([{ id: "a", version: 1, x: 0 }]);
    mount(api);
    press("canvas");
    move(api);
    move(api);
    const prepare = vi.fn((elements: readonly unknown[]) => elements);
    act(() => latest.discard(prepare as never));
    expect(prepare).toHaveBeenCalledWith([{ id: "a", version: 1, x: 0 }]);
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [{ id: "a", version: 1, x: 0 }] }),
    );
    expect(api.history.clear).toHaveBeenCalled();
    expect(latest.unsaved).toBe(false);
  });
});
