import { describe, expect, it } from "vitest";
import type { AtlasBoard, AtlasIndex } from "../src/api.ts";
import {
  atlasGrounding,
  atlasTags,
  boardDefiningRef,
  filterBoards,
  needsAttention,
  neighbours,
  orderedBoards,
  sectionsByKind,
  sectionsByTag,
} from "../src/atlas-nav.ts";

function board(slug: string, kind: AtlasBoard["kind"], extra: Partial<AtlasBoard> = {}) {
  return {
    slug,
    title: slug.replace(/-/g, " "),
    kind,
    status: "ok",
    layoutFrom: [],
    tags: [] as string[],
    uncheckedSources: 0,
    grounding: { code: 0, spec: 0, none: 0 },
    specOnly: [],
    specOnlyTruncated: false,
    staleSourceIds: [],
    warnings: [],
    issues: [],
    ...extra,
  } satisfies AtlasBoard;
}

const atlas: AtlasIndex = {
  boards: [
    board("signup", "flow", { status: "stale", staleSourceIds: ["s1"] }),
    board("web--cart", "screen", { status: "stale", grounding: { code: 3, spec: 1, none: 0 } }),
    board("overview-web", "overview", { grounding: { code: 5, spec: 2, none: 1 } }),
    board("web--checkout", "screen"),
    board("web--upload", "screen", {
      status: "invalid",
      grounding: { code: 100, spec: 100, none: 100 },
    }),
    board("checkout-payment", "flow"),
  ],
  refs: [],
  problems: [],
};

const slugs = (boards: AtlasBoard[]) => boards.map((b) => b.slug);

describe("orderedBoards", () => {
  it("groups overviews, screens, flows and keeps index order inside a group", () => {
    expect(slugs(orderedBoards(atlas))).toEqual([
      "overview-web",
      "web--cart",
      "web--checkout",
      "web--upload",
      "signup",
      "checkout-payment",
    ]);
  });
});

describe("filterBoards", () => {
  it("matches title or slug, ignoring case and surrounding space", () => {
    expect(slugs(filterBoards(atlas.boards, "  CART "))).toEqual(["web--cart"]);
    expect(slugs(filterBoards(atlas.boards, "web--"))).toEqual([
      "web--cart",
      "web--checkout",
      "web--upload",
    ]);
  });

  it("returns every board for a blank query", () => {
    expect(filterBoards(atlas.boards, " ")).toHaveLength(atlas.boards.length);
  });
});

describe("tags", () => {
  const tagged = [
    board("overview-web", "overview"),
    board("web--users", "screen", { tags: ["service-admin", "users"] }),
    board("web--login", "screen", { tags: ["auth"] }),
    board("web--admin-login", "screen", { tags: ["service-admin", "auth"] }),
    board("checkout", "flow"),
  ];

  it("lists every tag once, alphabetically, with its board count", () => {
    expect(atlasTags({ boards: tagged, refs: [], problems: [] })).toEqual([
      { tag: "auth", count: 2 },
      { tag: "service-admin", count: 2 },
      { tag: "users", count: 1 },
    ]);
  });

  it("filters by tag, and matches a tag as text", () => {
    expect(slugs(filterBoards(tagged, "", "auth"))).toEqual(["web--login", "web--admin-login"]);
    expect(slugs(filterBoards(tagged, "admin", "auth"))).toEqual(["web--admin-login"]);
    expect(slugs(filterBoards(tagged, "USERS"))).toEqual(["web--users"]);
  });

  it("groups by tag, a board under each of its tags, untagged boards last", () => {
    const sections = sectionsByTag(tagged);
    expect(sections.map((s) => [s.key, slugs(s.boards)])).toEqual([
      ["tag:auth", ["web--login", "web--admin-login"]],
      ["tag:service-admin", ["web--users", "web--admin-login"]],
      ["tag:users", ["web--users"]],
      ["untagged", ["overview-web", "checkout"]],
    ]);
  });

  it("groups by kind in sidebar order, leaving out empty kinds", () => {
    expect(
      sectionsByKind(orderedBoards({ boards: tagged, refs: [], problems: [] })).map((s) => s.key),
    ).toEqual(["kind:overview", "kind:screen", "kind:flow"]);
    expect(sectionsByKind([tagged[1] as AtlasBoard]).map((s) => s.key)).toEqual(["kind:screen"]);
  });
});

describe("atlasGrounding", () => {
  it("sums the grounding of every board that is not invalid", () => {
    expect(atlasGrounding(atlas)).toEqual({ code: 8, spec: 3, none: 1 });
  });
});

describe("needsAttention", () => {
  it("lists invalid boards before stale ones, in sidebar order", () => {
    expect(slugs(needsAttention(atlas))).toEqual(["web--upload", "web--cart", "signup"]);
  });

  it("is empty when every board is up to date", () => {
    expect(needsAttention({ ...atlas, boards: [board("a", "screen")] })).toEqual([]);
  });
});

describe("neighbours", () => {
  it("finds the boards around one in the middle of its group", () => {
    const { prev, next } = neighbours(atlas, "web--checkout");
    expect(prev?.slug).toBe("web--cart");
    expect(next?.slug).toBe("web--upload");
  });

  it("says where the board sits in its group, counted from 1", () => {
    const { index, count } = neighbours(atlas, "web--checkout");
    expect(index).toBe(2);
    expect(count).toBe(3);
  });

  it("stops at the start and the end of a group", () => {
    expect(neighbours(atlas, "web--cart").prev).toBeNull();
    expect(neighbours(atlas, "web--upload").next).toBeNull();
    expect(neighbours(atlas, "signup")).toMatchObject({ prev: null, next: atlas.boards[5] });
  });

  it("has nothing around the only board of a group", () => {
    expect(neighbours(atlas, "overview-web")).toEqual({
      prev: null,
      next: null,
      index: 1,
      count: 1,
    });
  });

  it("has nothing around a slug the atlas does not know", () => {
    expect(neighbours(atlas, "missing")).toEqual({ prev: null, next: null, index: 0, count: 0 });
  });
});

describe("boardDefiningRef", () => {
  const withRefs: AtlasIndex = {
    ...atlas,
    refs: [
      {
        ref: "web:checkout",
        definedIn: [
          { slug: "overview-web", nodeId: "checkout" },
          { slug: "web--checkout", nodeId: "screen" },
          { slug: "checkout-payment", nodeId: "start" },
        ],
        usedIn: [{ slug: "web--cart", nodeId: "go", edgeId: "e1" }],
      },
      {
        ref: "web:home",
        definedIn: [
          { slug: "signup", nodeId: "home" },
          { slug: "overview-web", nodeId: "home" },
        ],
        usedIn: [],
      },
      {
        ref: "web:flows",
        definedIn: [
          { slug: "signup", nodeId: "x" },
          { slug: "checkout-payment", nodeId: "y" },
        ],
        usedIn: [],
      },
      { ref: "web:login", definedIn: [], usedIn: [{ slug: "web--cart", nodeId: "a" }] },
    ],
  };

  it("prefers the screen's own board over the overview and a flow", () => {
    expect(boardDefiningRef(withRefs, "web:checkout")).toEqual({
      slug: "web--checkout",
      nodeId: "screen",
    });
  });

  it("prefers an overview over a flow", () => {
    expect(boardDefiningRef(withRefs, "web:home")?.slug).toBe("overview-web");
  });

  it("orders boards of the same kind by slug", () => {
    expect(boardDefiningRef(withRefs, "web:flows")?.slug).toBe("checkout-payment");
  });

  it("returns null for a ref that is only used, or unknown", () => {
    expect(boardDefiningRef(withRefs, "web:login")).toBeNull();
    expect(boardDefiningRef(withRefs, "web:nowhere")).toBeNull();
  });
});
