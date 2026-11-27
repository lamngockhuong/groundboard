import { describe, expect, it } from "vitest";
import type { AtlasBoard, AtlasIndex } from "../src/api.ts";
import {
  PALETTE_LIMIT,
  type PaletteGroup,
  paletteCommands,
  searchPalette,
} from "../src/palette.ts";
import type { BoardNode } from "../src/sources.ts";

const board = (slug: string, title: string, kind: AtlasBoard["kind"] = "screen"): AtlasBoard => ({
  slug,
  title,
  kind,
  status: "ok",
  layoutFrom: [],
  tags: [],
  uncheckedSources: 0,
  grounding: { code: 0, spec: 0, none: 0 },
  specOnly: [],
  specOnlyTruncated: false,
  staleSourceIds: [],
  warnings: [],
  issues: [],
});

const atlas: AtlasIndex = {
  boards: [
    board("place-order", "Place order", "flow"),
    board("web--cart", "My cart"),
    board("web--checkout", "Checkout"),
    board("overview-web", "Web screens", "overview"),
  ],
  refs: [
    { ref: "web:checkout", definedIn: [], usedIn: [] },
    { ref: "web:cart", definedIn: [], usedIn: [] },
  ],
  problems: [],
};

const nodes: BoardNode[] = [
  { nodeId: "pay", kind: "button", label: "Pay now", location: "src/pay.ts:4" },
  { nodeId: "cart-total", kind: "text", label: "Total", location: null },
];

const titles = (groups: PaletteGroup[]) => groups.map((g) => g.title);
const names = (group: PaletteGroup | undefined) =>
  (group?.items ?? []).map((item) =>
    item.type === "board"
      ? item.board.slug
      : item.type === "node"
        ? item.node.nodeId
        : item.type === "ref"
          ? item.ref.ref
          : item.command.id,
  );

describe("searchPalette", () => {
  it("matches the title or the slug, and refs by name", () => {
    expect(names(searchPalette("cart", { atlas, nodes: [] })[0])).toEqual(["web--cart"]);
    const groups = searchPalette("c", { atlas, nodes: [] });
    expect(titles(groups)).toEqual(["Boards", "Refs"]);
    expect(names(groups[1])).toEqual(["web:checkout", "web:cart"]);
  });

  it("ranks a title that starts with the query above one that contains it", () => {
    const withMore = {
      ...atlas,
      boards: [board("a", "Order history"), board("b", "Orders"), board("c", "Place order")],
    };
    const [boards] = searchPalette("order", { atlas: withMore, nodes: [] });
    expect(names(boards)).toEqual(["a", "b", "c"]);
    const [late] = searchPalette("place", { atlas: withMore, nodes: [] });
    expect(names(late)).toEqual(["c"]);
  });

  it("finds nodes by id, label or kind", () => {
    expect(names(searchPalette("pay", { atlas: null, nodes })[0])).toEqual(["pay"]);
    expect(names(searchPalette("total", { atlas: null, nodes })[0])).toEqual(["cart-total"]);
    expect(names(searchPalette("button", { atlas: null, nodes })[0])).toEqual(["pay"]);
  });

  it("lists boards in sidebar order for an empty query, and only nodes without an atlas", () => {
    expect(names(searchPalette("", { atlas, nodes })[0])).toEqual([
      "overview-web",
      "web--cart",
      "web--checkout",
      "place-order",
    ]);
    expect(titles(searchPalette("", { atlas: null, nodes }))).toEqual(["Nodes on this board"]);
  });

  it("keeps at most the limit per group and drops empty groups", () => {
    const many = Array.from({ length: 20 }, (_, i) => board(`b${i}`, `Board ${i}`));
    const [boards] = searchPalette("board", { atlas: { ...atlas, boards: many }, nodes: [] });
    expect(boards?.items).toHaveLength(PALETTE_LIMIT);
    expect(searchPalette("zzz", { atlas, nodes })).toEqual([]);
  });

  it("offers to open the board on screen beside it, by its title or the word split", () => {
    const commands = paletteCommands({ boardCount: 4, boardOnScreen: true, twoPanes: true });
    expect(commands.map((c) => c.id)).toEqual(["openBeside"]);
    expect(names(searchPalette("beside", { atlas, nodes, commands })[0])).toEqual(["openBeside"]);
    expect(titles(searchPalette("split", { atlas, nodes, commands }))).toEqual(["Commands"]);
    // Places come first: an empty query still opens the first board on Enter.
    expect(titles(searchPalette("", { atlas, nodes, commands })).at(-1)).toBe("Commands");
  });
});

describe("paletteCommands", () => {
  it("has no command to open beside on a narrow screen, with one board, or with none on screen", () => {
    expect(paletteCommands({ boardCount: 4, boardOnScreen: true, twoPanes: false })).toEqual([]);
    expect(paletteCommands({ boardCount: 1, boardOnScreen: true, twoPanes: true })).toEqual([]);
    expect(paletteCommands({ boardCount: 4, boardOnScreen: false, twoPanes: true })).toEqual([]);
  });
});
