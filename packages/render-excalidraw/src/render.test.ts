import { readFileSync } from "node:fs";
import path from "node:path";
import { layoutBoard } from "@groundboard/layout";
import { describe, expect, test } from "vitest";
import {
  exampleNames,
  loadBoard,
  renderExample,
  renderLifecycleSpec,
  screenBoard,
} from "../test/scenes.ts";
import type { ArrowElement, ExcalidrawElement, TextElement } from "./elements.ts";
import { renderExcalidraw, sourceLink, statusLine } from "./render.ts";

const byId = (elements: ExcalidrawElement[]) => new Map(elements.map((e) => [e.id, e]));

describe.each(exampleNames)("renderExcalidraw(%s)", (name) => {
  test("emits a valid envelope with unique ids and distinct seeds", async () => {
    const { scene } = await renderExample(name);
    expect(scene.type).toBe("excalidraw");
    expect(scene.version).toBe(2);
    expect(scene.files).toEqual({});
    const ids = scene.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seeds = scene.elements.map((e) => e.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const el of scene.elements) {
      expect(el.width, el.id).toBeGreaterThan(0);
      expect(el.height + (el.type === "arrow" ? 1 : 0), el.id).toBeGreaterThan(0);
    }
  });

  test("every binding is two-sided", async () => {
    const { scene } = await renderExample(name);
    const els = byId(scene.elements);
    for (const el of scene.elements) {
      if (el.type === "arrow") {
        for (const b of [el.startBinding, el.endBinding]) {
          expect(b).not.toBeNull();
          const target = els.get(b?.elementId as string);
          expect(target, `${el.id} -> ${b?.elementId}`).toBeDefined();
          expect(target?.boundElements).toContainEqual({ type: "arrow", id: el.id });
          expect(b?.mode).toBe("orbit");
          for (const v of b?.fixedPoint ?? []) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
      if (el.type === "text" && el.containerId) {
        const container = els.get(el.containerId);
        expect(container?.boundElements).toContainEqual({ type: "text", id: el.id });
      }
      for (const ref of el.boundElements ?? []) {
        const other = els.get(ref.id);
        expect(other, `${el.id} lists ${ref.id}`).toBeDefined();
        if (ref.type === "text") expect((other as TextElement).containerId).toBe(el.id);
        if (ref.type === "arrow") {
          const a = other as ArrowElement;
          expect([a.startBinding?.elementId, a.endBinding?.elementId]).toContain(el.id);
        }
      }
    }
  });

  test("every frameId points at a frame that contains the element", async () => {
    const { scene } = await renderExample(name);
    const els = byId(scene.elements);
    for (const el of scene.elements) {
      if (!el.frameId) continue;
      const f = els.get(el.frameId);
      expect(f?.type, `${el.id} frame`).toBe("frame");
      if (!f) continue;
      expect(el.x).toBeGreaterThanOrEqual(f.x - 1);
      expect(el.y).toBeGreaterThanOrEqual(f.y - 1);
      expect(el.x + el.width).toBeLessThanOrEqual(f.x + f.width + 1);
      expect(el.y + el.height).toBeLessThanOrEqual(f.y + f.height + 1);
      // Frames come after their children.
      expect(scene.elements.indexOf(f)).toBeGreaterThan(scene.elements.indexOf(el));
    }
  });

  test("every contained text sits inside its container and comes right after it", async () => {
    const { scene } = await renderExample(name);
    const els = byId(scene.elements);
    for (const el of scene.elements) {
      if (el.type !== "text" || !el.containerId) continue;
      const c = els.get(el.containerId) as ExcalidrawElement;
      if (c.type === "arrow") continue;
      expect(el.x, el.id).toBeGreaterThanOrEqual(c.x);
      expect(el.y, el.id).toBeGreaterThanOrEqual(c.y);
      expect(el.x + el.width, el.id).toBeLessThanOrEqual(c.x + c.width);
      expect(el.y + el.height, el.id).toBeLessThanOrEqual(c.y + c.height);
      expect(scene.elements.indexOf(el)).toBe(scene.elements.indexOf(c) + 1);
    }
  });

  test("label text is exactly the laid-out node text", async () => {
    const { scene, laidOut } = await renderExample(name);
    const els = byId(scene.elements);
    for (const node of laidOut.nodes) {
      const el = (els.get(`label/${node.id}`) ?? els.get(`node/${node.id}`)) as TextElement;
      expect(el.type).toBe("text");
      expect(el.text).toBe(node.text);
      expect(el.originalText).toBe(node.text);
    }
  });

  test("is byte-identical across two runs", async () => {
    const a = await renderExample(name);
    const b = await renderExample(name);
    expect(JSON.stringify(b.scene)).toBe(JSON.stringify(a.scene));
  });

  test("carries citations in customData and a not-checked status by default", async () => {
    const { scene, board } = await renderExample(name);
    const els = byId(scene.elements);
    for (const node of board.nodes) {
      const el = els.get(`node/${node.id}`);
      const data = el?.customData?.groundboard as { nodeId: string; sources: unknown[] };
      expect(data.nodeId).toBe(node.id);
      expect(data.sources).toHaveLength(node.sourceIds.length);
      // No commit in the examples, so no links.
      expect(el?.link).toBeNull();
    }
    const status = els.get("title-status") as TextElement;
    expect(status.text).toBe("Sources NOT checked");
    const titleData = els.get("title")?.customData?.groundboard as { sourcesChecked: unknown };
    expect(titleData.sourcesChecked).toBe(false);
  });
});

describe("links and status", () => {
  test("builds a blob link only when repo url and commit exist", () => {
    const source = { id: "s", kind: "code" as const, path: "src/a b#c.ts", line: 4, endLine: 6 };
    expect(sourceLink({ url: "https://github.com/o/r.git", commit: "abc1234" }, source)).toBe(
      "https://github.com/o/r/blob/abc1234/src/a%20b%23c.ts#L4-L6",
    );
    expect(sourceLink({ url: "https://github.com/o/r" }, source)).toBeNull();
    expect(sourceLink(undefined, source)).toBeNull();
    const figma = { id: "f", kind: "figma" as const, fileKey: "AbCdEf0123456789", nodeId: "12:34" };
    expect(sourceLink(undefined, figma)).toBe(
      "https://www.figma.com/design/AbCdEf0123456789?node-id=12-34",
    );
  });

  test("sets links and checked status when a commit is known", async () => {
    const board = loadBoard("checkout-flow", (raw) => {
      raw.repo = {
        url: "https://github.com/lamngockhuong/groundboard",
        commit: "0123456789abcdef",
      };
    });
    const scene = renderExcalidraw(await layoutBoard(board), board, {
      sourcesChecked: { root: "working tree", commit: "0123456789abcdef" },
    });
    const els = byId(scene.elements);
    expect(els.get("node/n-capture")?.link).toBe(
      "https://github.com/lamngockhuong/groundboard/blob/0123456789abcdef/examples/fixtures/checkout/payment.ts#L26",
    );
    expect((els.get("title-status") as TextElement).text).toBe(
      "Sources checked against commit 0123456789abcdef",
    );
    expect(statusLine({ root: "working tree" })).toBe("Sources checked against the working tree");
  });
});

describe("specification grounding", () => {
  const data = (el: ExcalidrawElement | undefined) =>
    (el?.customData as { groundboard?: Record<string, unknown> } | undefined)?.groundboard;

  test("marks spec-only claims dotted with a spec tag, and records grounding other than code", async () => {
    const { scene } = await renderLifecycleSpec("web--signup");
    const els = byId(scene.elements);
    const create = els.get("node/create-account");
    expect(create?.strokeStyle).toBe("dotted");
    expect(data(create)?.grounding).toBe("spec");
    const tag = els.get("node/create-account/spec") as TextElement;
    expect(tag.text).toBe("spec");
    expect(tag.frameId).toBe("node/signup");
    expect(data(tag)?.nodeId).toBe("create-account");
    // A link (drawn as text) is tagged too; an unresolved one is "none" and keeps its "?".
    expect(data(els.get("node/sign-in"))?.grounding).toBe("none");
    expect(els.get("node/sign-in/spec")).toBeUndefined();
    expect(els.get("node/sign-in/unresolved")).toBeDefined();
    // A non-interactive element is not a claim and carries no grounding.
    expect(data(els.get("node/form"))?.grounding).toBeUndefined();
    expect(els.get("node/form")?.strokeStyle).not.toBe("dotted");
    // The screen frame says it is backed by the specification only.
    expect((els.get("node/signup") as { name?: string }).name).toBe(
      "Sign up · from a client mockup · spec only",
    );
    // The navigates edge to another board is a tag with a dotted outline.
    const edge = els.get("ref-tag/create-account-to-verify");
    expect(edge?.strokeStyle).toBe("dotted");
    expect(data(edge)?.grounding).toBe("spec");
    expect(data(els.get("ref-line/create-account-to-verify"))?.grounding).toBe("spec");
  });

  test("says in the title how many claims are backed by code, and lists spec only in the legend", async () => {
    const { scene } = await renderLifecycleSpec("web--signup");
    const els = byId(scene.elements);
    expect((els.get("title-grounding") as TextElement).text).toBe("0 of 7 claims backed by code");
    expect(els.get("title-figma")).toBeUndefined();
    expect((els.get("legend-label/spec") as TextElement).text).toMatch(/^spec only/);
    const status = els.get("title-status") as TextElement;
    const coverage = els.get("title-grounding") as TextElement;
    expect(coverage.y).toBeGreaterThanOrEqual(status.y + status.height);
    expect(coverage.y + coverage.height).toBeLessThanOrEqual(0);
  });

  test("words the unchecked line by what cannot be checked", async () => {
    const figmaOnly = await renderLifecycleSpec("overview-web");
    expect((byId(figmaOnly.scene.elements).get("title-figma") as TextElement).text).toBe(
      "2 Figma sources not checked",
    );
    const withLink = await renderLifecycleSpec("overview-web", (raw) => {
      (raw.sources as unknown[]).push(
        { id: "lnk", kind: "link", url: "https://docs.example.com/flow", title: "Flow" },
        { id: "drive", kind: "mockup", label: "Kept in Drive" },
      );
    });
    expect((byId(withLink.scene.elements).get("title-figma") as TextElement).text).toBe(
      "4 sources not checked (Figma, links, mockups without a file)",
    );
  });

  test("gives doc and committed mockup sources a repository link only when the board has one", async () => {
    const plain = await renderLifecycleSpec("web--signup");
    const sources = (el: ExcalidrawElement | undefined) =>
      data(el)?.sources as Array<Record<string, unknown>>;
    expect(sources(byId(plain.scene.elements).get("node/email"))?.[0]).toEqual({
      id: "req-email",
      kind: "doc",
      path: "docs/requirements.md",
      line: 16,
      quote: "The Email field stores the address the code is sent to.",
    });
    const linked = await renderLifecycleSpec("web--signup", (raw) => {
      raw.repo = { url: "https://github.com/o/r", commit: "abc1234" };
    });
    const els = byId(linked.scene.elements);
    expect(sources(els.get("node/email"))?.[0]?.url).toBe(
      "https://github.com/o/r/blob/abc1234/docs/requirements.md#L16",
    );
    expect(sources(els.get("node/signup"))?.[0]).toEqual({
      id: "mockup-signup",
      kind: "mockup",
      label: "Sign up mockup",
      path: "design/signup-mockup.png",
      url: "https://github.com/o/r/blob/abc1234/design/signup-mockup.png",
    });
    expect(els.get("node/email")?.link).toBe(
      "https://github.com/o/r/blob/abc1234/docs/requirements.md#L16",
    );
  });

  test("links a link source to its own URL", () => {
    const link = {
      id: "l",
      kind: "link" as const,
      url: "https://docs.example.com/a?x=1",
      title: "A",
    };
    expect(sourceLink(undefined, link)).toBe("https://docs.example.com/a?x=1");
    expect(sourceLink(undefined, { id: "m", kind: "mockup" as const, label: "M" })).toBeNull();
  });
});

describe("module boundary", () => {
  test("the renderer never imports elkjs or the layout engine", () => {
    const dir = path.join(import.meta.dirname);
    for (const file of ["render.ts", "elements.ts", "styles.ts", "index.ts"]) {
      const source = readFileSync(path.join(dir, file), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/elkjs/);
        // Only types, text measurement and wrapping may come from the layout package.
        if (spec?.startsWith("@groundboard/layout")) {
          expect([
            "@groundboard/layout/types",
            "@groundboard/layout/text",
            "@groundboard/layout/measure",
          ]).toContain(spec);
        }
      }
    }
    // And those layout modules do not reach elkjs either.
    const layoutSrc = path.join(import.meta.dirname, "../../layout/src");
    for (const file of ["types.ts", "text.ts", "measure.ts"]) {
      expect(readFileSync(path.join(layoutSrc, file), "utf8")).not.toMatch(
        /elkjs|to-elk|layout\.ts/,
      );
    }
  });
});

describe("element ids", () => {
  const duplicates = (elements: ExcalidrawElement[]) =>
    elements.map((e) => e.id).filter((id, i, ids) => ids.indexOf(id) !== i);

  test("an edge named like another edge's label does not share its element id", async () => {
    const { scene } = await renderExample("checkout-flow", (raw) => {
      const edges = raw.edges as Array<Record<string, unknown>>;
      const labelled = edges.find((e) => e.label) as Record<string, unknown>;
      const { label: _label, ...copy } = edges.find((e) => e !== labelled) as Record<
        string,
        unknown
      >;
      edges.push({ ...copy, id: `label-${labelled.id}` });
    });
    expect(duplicates(scene.elements)).toEqual([]);
  });

  test("a nested group named like another group's label does not share its element id", async () => {
    const { scene } = await renderExample("checkout-flow", (raw) => {
      const groups = (raw.groups ?? []) as Array<Record<string, unknown>>;
      raw.groups = groups;
      groups.push(
        { id: "p", label: "P" },
        { id: "a", label: "A", parentId: "p" },
        { id: "label-a", label: "B", parentId: "p" },
      );
      const nodes = raw.nodes as Array<Record<string, unknown>>;
      (nodes[0] as Record<string, unknown>).groupId = "a";
      (nodes[1] as Record<string, unknown>).groupId = "label-a";
    });
    expect(duplicates(scene.elements)).toEqual([]);
  });

  test("a node named like another node's mark does not share its element id", async () => {
    const board = screenBoard();
    const pay = board.nodes.find((n) => n.id === "pay");
    expect(pay?.action).toBeDefined();
    board.nodes.push({
      ...pay,
      id: "pay-action",
      label: "Pay later",
    } as (typeof board.nodes)[number]);
    const scene = renderExcalidraw(await layoutBoard(board), board);
    expect(scene.elements.some((e) => e.id === "node/pay/action")).toBe(true);
    expect(duplicates(scene.elements)).toEqual([]);
  });
});
