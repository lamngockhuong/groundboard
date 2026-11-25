import { describe, expect, it } from "vitest";
import { lockedItemAt } from "../src/locked-hit.ts";

const node = (id: string, x: number, y: number, size: number, locked: boolean) => ({
  id: `node/${id}`,
  type: "rectangle",
  x,
  y,
  width: size,
  height: size,
  locked,
  customData: { groundboard: { nodeId: id } },
});

// A screen the person may drag, holding a button that edit mode locks.
const screen = node("checkout", 0, 0, 200, false);
const button = node("pay", 50, 50, 40, true);
const label = {
  id: "label-pay",
  type: "text",
  x: 55,
  y: 60,
  width: 30,
  height: 10,
  locked: true,
  containerId: "node/pay",
};
const arrow = {
  id: "edge/e1",
  type: "arrow",
  x: 300,
  y: 100,
  width: 100,
  height: 0,
  points: [
    [0, 0],
    [100, 0],
  ],
  locked: true,
  customData: { groundboard: { edgeId: "e1" } },
};
const legend = {
  id: "legend",
  type: "rectangle",
  x: 500,
  y: 0,
  width: 50,
  height: 50,
  locked: true,
};

const scene = [screen, button, label, arrow, legend];

describe("lockedItemAt", () => {
  it("picks the locked node under the point, not the box around it", () => {
    expect(lockedItemAt(scene, { x: 52, y: 85 }, 8)).toBe("node/pay");
  });

  it("takes a label for the box it sits in", () => {
    expect(lockedItemAt(scene, { x: 60, y: 65 }, 8)).toBe("node/pay");
  });

  it("leaves an unlocked node to Excalidraw", () => {
    expect(lockedItemAt(scene, { x: 150, y: 150 }, 8)).toBeNull();
  });

  it("picks an arrow near its line, within the tolerance only", () => {
    expect(lockedItemAt(scene, { x: 350, y: 105 }, 8)).toBe("edge/e1");
    expect(lockedItemAt(scene, { x: 350, y: 120 }, 8)).toBeNull();
  });

  it("ignores locked chrome that is neither a node nor an edge, and empty space", () => {
    expect(lockedItemAt(scene, { x: 520, y: 20 }, 8)).toBeNull();
    expect(lockedItemAt(scene, { x: 900, y: 900 }, 8)).toBeNull();
  });

  it("ignores deleted elements", () => {
    const gone = [screen, { ...button, isDeleted: true }];
    expect(lockedItemAt(gone, { x: 60, y: 85 }, 8)).toBeNull();
  });
});
