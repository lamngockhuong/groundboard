import { afterEach, describe, expect, it } from "vitest";
import type { AtlasBoard, AtlasIndex } from "../src/api.ts";
import { flowHintBoxes, flowPrompt, missingFlowPlaces, missingFlowSet } from "../src/flow-hints.ts";
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

describe("flowHintBoxes", () => {
  const data = (nodeId: string, ref?: string, kind = "element") => ({
    groundboard: { nodeId, kind, ...(ref ? { ref } : {}) },
  });
  const missing = new Set(["web:s/pay", "web:s/old"]);

  it("gives one box per element with no flow, from the node's own element", () => {
    const elements = [
      {
        id: "node/pay/action",
        x: 90,
        y: 0,
        width: 8,
        height: 8,
        customData: data("pay", "web:s/pay"),
      },
      { id: "node/pay", x: 10, y: 20, width: 80, height: 30, customData: data("pay", "web:s/pay") },
      {
        id: "label/pay",
        x: 12,
        y: 22,
        width: 40,
        height: 10,
        customData: data("pay", "web:s/pay"),
      },
      { id: "node/ok", x: 0, y: 0, width: 10, height: 10, customData: data("ok", "web:s/ok") },
      {
        id: "node/old",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        isDeleted: true,
        customData: data("old", "web:s/old"),
      },
      {
        id: "node/scr",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        customData: data("scr", "web:s/pay", "screen"),
      },
      { id: "plain", x: 0, y: 0 },
    ];
    expect(flowHintBoxes(elements, missing)).toEqual([
      { nodeId: "pay", ref: "web:s/pay", x: 10, y: 20, width: 80, height: 30 },
    ]);
  });

  it("reads the `node-<id>` ids of older scenes, and nothing with an empty set", () => {
    const elements = [
      { id: "node-pay", x: 1, y: 2, width: 3, height: 4, customData: data("pay", "web:s/pay") },
    ];
    expect(flowHintBoxes(elements, missing)).toHaveLength(1);
    expect(flowHintBoxes(elements, new Set())).toEqual([]);
  });
});

describe("missingFlowPlaces", () => {
  const ref = (
    name: string,
    slug: string,
    nodeId: string,
    usedIn: AtlasIndex["refs"][number]["usedIn"] = [],
  ) => ({ ref: name, definedIn: [{ slug, nodeId }], usedIn, needsFlow: true as const });

  const index = {
    boards: [
      board("web--upload", "screen"),
      board("overview-web", "overview"),
      board("place-order", "flow"),
      board("web--cart", "screen"),
      board("api--orders", "api"),
    ],
    refs: [
      ref("web:cart/pay", "web--cart", "pay"),
      ref("web:cart/save", "web--cart", "save", [{ slug: "place-order", nodeId: "s" }]),
      ref("web:upload/import", "web--upload", "import"),
      ref("web:upload/pick", "web--upload", "pick"),
      // Defined only on a board that is not a screen: no place to open.
      ref("web:odd/thing", "api--orders", "thing"),
    ],
    problems: [],
  } as unknown as AtlasIndex;

  it("groups the elements with no flow by screen board, in sidebar order", () => {
    expect(missingFlowPlaces(index)).toEqual([
      {
        slug: "web--upload",
        title: "web--upload",
        items: [
          { ref: "web:upload/import", nodeId: "import", shortRef: "import" },
          { ref: "web:upload/pick", nodeId: "pick", shortRef: "pick" },
        ],
      },
      {
        slug: "web--cart",
        title: "web--cart",
        items: [{ ref: "web:cart/pay", nodeId: "pay", shortRef: "pay" }],
      },
    ]);
  });

  it("shortens each ref by the screen ref its board defines, and keeps any other ref whole", () => {
    // A layout board defines `web:layout`; one of its elements carries the ref of another
    // screen, which the list shows in full rather than cut to a misleading tail.
    const layout = {
      boards: [board("web--layout", "screen")],
      refs: [
        { ref: "web:layout", definedIn: [{ slug: "web--layout", nodeId: "root" }], usedIn: [] },
        ref("web:layout/header-logout", "web--layout", "logout"),
        ref("web:other/stray", "web--layout", "stray"),
      ],
      problems: [],
    } as unknown as AtlasIndex;
    expect(missingFlowPlaces(layout)[0]?.items).toEqual([
      { ref: "web:layout/header-logout", nodeId: "logout", shortRef: "header-logout" },
      { ref: "web:other/stray", nodeId: "stray", shortRef: "web:other/stray" },
    ]);
  });

  it("keeps every ref whole when the board defines no screen ref and its refs span screens", () => {
    const mixed = {
      boards: [board("web--mixed", "screen")],
      refs: [ref("web:a/one", "web--mixed", "one"), ref("web:b/two", "web--mixed", "two")],
      problems: [],
    } as unknown as AtlasIndex;
    expect(missingFlowPlaces(mixed)[0]?.items.map((i) => i.shortRef)).toEqual([
      "web:a/one",
      "web:b/two",
    ]);
  });

  it("carries the text and role each element shows, and leaves them out where the index has none", () => {
    const labelled = {
      boards: [board("web--layout", "screen")],
      refs: [
        { ref: "web:layout", definedIn: [{ slug: "web--layout", nodeId: "root" }], usedIn: [] },
        {
          ref: "web:layout/header-logout",
          definedIn: [
            {
              slug: "web--layout",
              nodeId: "logout",
              label: "ログアウト\n (Đăng xuất)",
              role: "button",
            },
          ],
          usedIn: [],
          needsFlow: true,
        },
        // An index written before labels were carried.
        ref("web:layout/footer-help", "web--layout", "help"),
        // Only blanks, as a hand-edited index might hold.
        {
          ref: "web:layout/footer-terms",
          definedIn: [{ slug: "web--layout", nodeId: "terms", label: "  " }],
          usedIn: [],
          needsFlow: true,
        },
      ],
      problems: [],
    } as unknown as AtlasIndex;
    expect(missingFlowPlaces(labelled)[0]?.items).toEqual([
      {
        ref: "web:layout/header-logout",
        nodeId: "logout",
        shortRef: "header-logout",
        label: "ログアウト (Đăng xuất)",
        role: "button",
      },
      { ref: "web:layout/footer-help", nodeId: "help", shortRef: "footer-help" },
      { ref: "web:layout/footer-terms", nodeId: "terms", shortRef: "footer-terms" },
    ]);
  });

  it("is empty when nothing is missing or there is no atlas", () => {
    expect(missingFlowPlaces(null)).toEqual([]);
    expect(missingFlowPlaces({ ...index, refs: [index.refs[1]] } as AtlasIndex)).toEqual([]);
  });
});
