import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChange,
  DEFAULT_PREFS,
  keepLayers,
  readPrefs,
  readStoredPrefs,
  storeChange,
  type ViewPrefs,
} from "../src/view-prefs.ts";

describe("view prefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("starts from the defaults, then reads back the choices made last", () => {
    expect(readStoredPrefs()).toEqual(DEFAULT_PREFS);
    storeChange({ designShown: false });
    storeChange({ font: "mono" });
    storeChange({ sourcesOpen: false });
    storeChange({ layer: "arrows", hidden: true });
    expect(readStoredPrefs()).toEqual({
      designShown: false,
      hiddenLayers: ["arrows"],
      font: "mono",
      sourcesOpen: false,
    });
  });

  it("stores one layer at a time, keeping the others hidden", () => {
    storeChange({ layer: "arrows", hidden: true });
    storeChange({ layer: "notes", hidden: true });
    storeChange({ layer: "arrows", hidden: false });
    expect(readStoredPrefs().hiddenLayers).toEqual(["notes"]);
  });

  it("keeps the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeChange({ layer: "refs", hidden: true })).not.toThrow();
    expect(readStoredPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("changes one choice", () => {
    const prefs: ViewPrefs = { ...DEFAULT_PREFS, hiddenLayers: ["refs"] };
    expect(applyChange(prefs, { font: "hand" })).toEqual({ ...prefs, font: "hand" });
    expect(applyChange(prefs, { layer: "marks", hidden: true }).hiddenLayers).toEqual([
      "refs",
      "marks",
    ]);
    expect(applyChange(prefs, { layer: "refs", hidden: false }).hiddenLayers).toEqual([]);
    expect(applyChange(prefs, { layer: "refs", hidden: true }).hiddenLayers).toEqual(["refs"]);
  });

  it("keeps only the hidden layers the board has", () => {
    const prefs: ViewPrefs = { ...DEFAULT_PREFS, hiddenLayers: ["arrows", "notes"] };
    expect(keepLayers(prefs, ["notes", "refs"]).hiddenLayers).toEqual(["notes"]);
    expect(keepLayers(prefs, ["arrows", "notes"])).toBe(prefs);
  });

  it("stores the flow-hint layer like the others, and drops it on a board with no marks", () => {
    storeChange({ layer: "flowHints", hidden: true });
    expect(readStoredPrefs().hiddenLayers).toEqual(["flowHints"]);
    const prefs: ViewPrefs = { ...DEFAULT_PREFS, hiddenLayers: ["flowHints", "notes"] };
    expect(keepLayers(prefs, ["notes"]).hiddenLayers).toEqual(["notes"]);
    expect(keepLayers(prefs, ["notes", "flowHints"])).toBe(prefs);
  });

  it("reads back only choices of the right shape", () => {
    expect(readPrefs(DEFAULT_PREFS)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toBeNull();
    expect(readPrefs([])).toBeNull();
    expect(readPrefs({ ...DEFAULT_PREFS, designShown: "yes" })).toBeNull();
    expect(readPrefs({ ...DEFAULT_PREFS, font: "comic" })).toBeNull();
    expect(readPrefs({ ...DEFAULT_PREFS, hiddenLayers: ["arrows", 1] })).toBeNull();
    expect(readPrefs({ ...DEFAULT_PREFS, hiddenLayers: Array(20).fill("arrows") })).toBeNull();
  });
});
