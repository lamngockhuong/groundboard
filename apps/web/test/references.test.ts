import { describe, expect, it } from "vitest";
import {
  hasReferences,
  isReferenceElement,
  missingReferencesNote,
  withReferencesShown,
} from "../src/references.ts";

const elements = [
  { id: "node-users", version: 1 },
  { id: "refimg-users", version: 3 },
  { id: "refimg-users-add", version: 1, isDeleted: false },
];

describe("reference images in the viewer", () => {
  it("are recognised by their id prefix only", () => {
    expect(elements.map(isReferenceElement)).toEqual([false, true, true]);
    expect(isReferenceElement({ id: 7 })).toBe(false);
    expect(isReferenceElement(null)).toBe(false);
    expect(hasReferences(elements)).toBe(true);
    expect(hasReferences([{ id: "node-users" }])).toBe(false);
    expect(isReferenceElement({ id: "refimg/users/node/add" })).toBe(true);
    expect(hasReferences([{ id: "node/users" }, { id: "edge/refimg" }])).toBe(false);
  });

  it("hide and show by marking them deleted, leaving every other element untouched", () => {
    const hidden = withReferencesShown(elements, false);
    expect(hidden[0]).toBe(elements[0]);
    expect(hidden[1]).toEqual({ id: "refimg-users", version: 4, isDeleted: true });
    expect(hidden[2]).toEqual({ id: "refimg-users-add", version: 2, isDeleted: true });
    const shown = withReferencesShown(hidden, true);
    expect(shown[1]).toEqual({ id: "refimg-users", version: 5, isDeleted: false });
    // Already in the asked state: the same object, so Excalidraw sees no change.
    expect(withReferencesShown(elements, true)[2]).toBe(elements[2]);
  });

  it("say when a board cites Figma but nothing is cached, and how to fetch it", () => {
    expect(missingReferencesNote(undefined)).toBeNull();
    expect(missingReferencesNote({ frames: 0, cached: 0 })).toBeNull();
    expect(missingReferencesNote({ frames: 2, cached: 1 })).toBeNull();
    const note = missingReferencesNote({ frames: 2, cached: 0 });
    expect(note).toContain("2 Figma frames");
    expect(note).toContain("/groundboard:screen");
    expect(note).toContain("groundboard figma pull");
  });
});
