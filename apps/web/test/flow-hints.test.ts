import { afterEach, describe, expect, it } from "vitest";
import type { AtlasBoard, AtlasIndex } from "../src/api.ts";
import { flowPrompt, missingFlowSet } from "../src/flow-hints.ts";
import { setLocale } from "../src/i18n.ts";

afterEach(() => setLocale("en"));

const board = (slug: string, kind: AtlasBoard["kind"], status: AtlasBoard["status"] = "ok") =>
  ({ slug, title: slug, kind, status }) as AtlasBoard;

function atlas(usedIn: AtlasIndex["refs"][number]["usedIn"]): AtlasIndex {
  return {
    boards: [
      board("web--cart", "screen"),
      board("place-order", "flow"),
      board("broken", "flow", "invalid"),
    ],
    refs: [
      {
        ref: "web:cart/pay",
        definedIn: [{ slug: "web--cart", nodeId: "pay" }],
        usedIn,
        needsFlow: true,
      },
      { ref: "web:cart/back", definedIn: [{ slug: "web--cart", nodeId: "back" }], usedIn: [] },
    ],
    problems: [],
  } as unknown as AtlasIndex;
}

describe("missingFlowSet", () => {
  it("is empty with no atlas, as for a pasted board", () => {
    expect(missingFlowSet(null).size).toBe(0);
  });

  it("lists an element that needs a flow and has none", () => {
    expect([...missingFlowSet(atlas([]))]).toEqual(["web:cart/pay"]);
  });

  it("a step on a flow board covers it", () => {
    expect(missingFlowSet(atlas([{ slug: "place-order", nodeId: "click" }])).size).toBe(0);
  });

  it("a screen board, an edge's toRef or an invalid board does not", () => {
    for (const place of [
      { slug: "web--cart", nodeId: "x" },
      { slug: "place-order", nodeId: "x", edgeId: "e" },
      { slug: "broken", nodeId: "x" },
    ]) {
      expect([...missingFlowSet(atlas([place]))]).toEqual(["web:cart/pay"]);
    }
  });
});

describe("flowPrompt", () => {
  it("names the element, the screen and the ref on one line", () => {
    expect(flowPrompt({ label: "Pay\n now", screen: "Checkout", ref: "web:checkout/pay" })).toBe(
      "/groundboard:board Draw the flow when Pay now is pressed on Checkout (`web:checkout/pay`)",
    );
  });

  it("drops backticks, cuts a long label and falls back to the ref", () => {
    const prompt = flowPrompt({ label: `a\`b${"x".repeat(200)}`, screen: "S", ref: "web:s/e" });
    expect(prompt).not.toContain("a`b");
    expect(prompt).toContain(`ab${"x".repeat(117)}…`);
    expect(prompt).not.toMatch(/\n/);
    expect(flowPrompt({ label: "  ", ref: "web:s/e" })).toBe(
      "/groundboard:board Draw the flow when web:s/e is pressed on web:s (`web:s/e`)",
    );
  });

  it("is written in the interface language", () => {
    const args = { label: "Import", screen: "Upload", ref: "web:users-upload/import" };
    setLocale("vi");
    expect(flowPrompt(args)).toBe(
      "/groundboard:board Vẽ flow khi bấm Import trên Upload (`web:users-upload/import`)",
    );
    setLocale("ja");
    expect(flowPrompt(args)).toBe(
      "/groundboard:board Upload で Import を押したときのフローを描いて (`web:users-upload/import`)",
    );
  });
});
