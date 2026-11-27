import { describe, expect, it } from "vitest";
import { layerOf, presentLayers, withLayersHidden } from "../src/layers.ts";

const data = (nodeId: string) => ({ groundboard: { nodeId, kind: "element" } });

const scene = [
  { id: "node-save-action", customData: data("save-action") },
  { id: "node-save-action-action", customData: data("save-action") },
  { id: "node-save-action-spec", customData: data("save-action") },
  { id: "node-ask-unresolved", customData: data("ask") },
  { id: "node-box-box", customData: data("box") },
  { id: "label-save-action" },
  { id: "edge-e1", version: 3 },
  { id: "edge-label-e1" },
  { id: "edge-e1-spec" },
  { id: "ref-tag-r1" },
  { id: "ref-tag-r1-number" },
  { id: "ref-line-r1" },
  { id: "legend" },
  { id: "legend-swatch-step", frameId: "legend" },
  { id: "title" },
  { id: "title-grounding" },
  { id: "title-question" },
  { id: "title-status" },
  { id: "refimg-legend-label-reference", frameId: "legend" },
  { id: "refimg-shot", isDeleted: false },
  { id: "group-g1" },
];

describe("layerOf", () => {
  it("sorts the `kind/…` ids of current scenes, whatever the board ids look like", () => {
    const current: Array<{
      id: string;
      frameId?: string;
      customData?: unknown;
      isDeleted?: boolean;
    }> = [
      { id: "node/save-action", customData: data("save-action") },
      { id: "node/save/action", customData: data("save") },
      { id: "node/save/spec", customData: data("save") },
      { id: "node/ask/unresolved", customData: data("ask") },
      { id: "node/box/box", customData: data("box") },
      { id: "label/save" },
      { id: "edge/label-e1" },
      { id: "edge-label/e1" },
      { id: "edge/e1/spec" },
      { id: "ref-tag/r1" },
      { id: "ref-tag/r1/number" },
      { id: "ref-line/r1" },
      { id: "legend-swatch/step", frameId: "legend" },
      { id: "refimg/legend-label/reference", frameId: "legend" },
      { id: "refimg/legend-x" },
      { id: "group/g1" },
      { id: "group-label/g1" },
    ];
    expect(Object.fromEntries(current.map((e) => [e.id, layerOf(e)]))).toEqual({
      "node/save-action": null,
      "node/save/action": "marks",
      "node/save/spec": "marks",
      "node/ask/unresolved": "marks",
      "node/box/box": null,
      "label/save": null,
      "edge/label-e1": "arrows",
      "edge-label/e1": "arrows",
      "edge/e1/spec": "arrows",
      "ref-tag/r1": "refs",
      "ref-tag/r1/number": "refs",
      "ref-line/r1": "refs",
      "legend-swatch/step": "notes",
      "refimg/legend-label/reference": null,
      "refimg/legend-x": null,
      "group/g1": null,
      "group-label/g1": null,
    });
    // The legend row of reference images follows the notes; a screen named `legend-x` does not.
    const hidden = withLayersHidden(current, new Set(["notes"]));
    const deleted = (id: string) => hidden.find((e) => e.id === id)?.isDeleted === true;
    expect(deleted("refimg/legend-label/reference")).toBe(true);
    expect(deleted("refimg/legend-x")).toBe(false);
  });

  it("sorts every drawn part of a scene rendered before `/` ids into its layer", () => {
    expect(Object.fromEntries(scene.map((e) => [e.id, layerOf(e)]))).toEqual({
      // The node's own element, even when its id ends like a mark.
      "node-save-action": null,
      "node-save-action-action": "marks",
      "node-save-action-spec": "marks",
      "node-ask-unresolved": "marks",
      // A checkbox's box is part of the wireframe, not a mark.
      "node-box-box": null,
      "label-save-action": null,
      "edge-e1": "arrows",
      "edge-label-e1": "arrows",
      "edge-e1-spec": "arrows",
      "ref-tag-r1": "refs",
      "ref-tag-r1-number": "refs",
      "ref-line-r1": "refs",
      legend: "notes",
      "legend-swatch-step": "notes",
      title: null,
      "title-grounding": "notes",
      // The question and the sources-checked status are part of the board.
      "title-question": null,
      "title-status": null,
      "refimg-legend-label-reference": null,
      // Reference images have the Design button.
      "refimg-shot": null,
      "group-g1": null,
    });
  });

  it("lists the layers a scene has, in menu order", () => {
    expect(presentLayers(scene)).toEqual(["arrows", "refs", "marks", "notes"]);
    expect(presentLayers([{ id: "edge-x" }, { id: "node-a" }])).toEqual(["arrows"]);
  });
});

describe("flow-hint layer", () => {
  it("is never an element's layer, so hiding it leaves the scene as it is", () => {
    expect(scene.map(layerOf)).not.toContain("flowHints");
    expect(presentLayers(scene)).not.toContain("flowHints");
    const hidden = withLayersHidden(scene, new Set(["flowHints"] as const));
    hidden.forEach((element, i) => {
      expect(element).toBe(scene[i]);
    });
  });
});

describe("withLayersHidden", () => {
  it("hides the elements of hidden layers and brings them back, bumping only what changed", () => {
    const hidden = withLayersHidden(scene, new Set(["arrows"] as const));
    const arrow = hidden.find((e) => e.id === "edge-e1");
    expect(arrow).toMatchObject({ isDeleted: true, version: 4 });
    expect(hidden.find((e) => e.id === "ref-tag-r1")).toBe(
      scene.find((e) => e.id === "ref-tag-r1"),
    );
    expect(hidden.find((e) => e.id === "node-save-action")).toBe(scene[0]);

    const shown = withLayersHidden(hidden, new Set());
    expect(shown.find((e) => e.id === "edge-e1")).toMatchObject({ isDeleted: false, version: 5 });
    // Already shown: the same object back.
    expect(shown.find((e) => e.id === "legend")).toBe(hidden.find((e) => e.id === "legend"));
  });

  it("shows the legend row of reference images only with both the design and the notes", () => {
    const row = (els: Array<{ id: string; isDeleted?: boolean }>) =>
      els.find((e) => e.id === "refimg-legend-label-reference")?.isDeleted === true;
    expect(row(withLayersHidden(scene, new Set(["notes"] as const)))).toBe(true);
    expect(row(withLayersHidden(scene, new Set(), false))).toBe(true);
    expect(row(withLayersHidden(scene, new Set(), true))).toBe(false);
  });
});
