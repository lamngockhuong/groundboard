import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AtlasIndex } from "../src/api.ts";
import { AtlasHome } from "../src/components/AtlasHome.tsx";
import { setLocale } from "../src/i18n.ts";
import { buildLibraryIndex } from "../src/library-index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The missing-flow card of the atlas home, on the states fixture: web--users-upload has eight
 * elements with no flow, among them the Import button (`confirm-import`). It is the only screen
 * board in the list, so its group starts open.
 */
function statesIndex(): AtlasIndex {
  const dir = path.resolve(import.meta.dirname, "../../../examples/fixtures/states/.groundboard");
  return buildLibraryIndex(
    readdirSync(dir)
      .filter((f) => f.endsWith(".board.json"))
      .map((f) => ({
        slug: f.replace(".board.json", ""),
        input: {
          type: "board" as const,
          board: JSON.parse(readFileSync(path.join(dir, f), "utf8")),
        },
        openedAt: 1,
      })),
  );
}

/** The index as a viewer gets it from an export written before labels were carried. */
function withoutLabels(index: AtlasIndex): AtlasIndex {
  return {
    ...index,
    refs: index.refs.map((r) => ({
      ...r,
      definedIn: r.definedIn.map(({ label: _label, role: _role, ...place }) => place),
    })),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setLocale("en");
});

function render(atlas: AtlasIndex) {
  act(() => root.render(createElement(AtlasHome, { atlas })));
  const link = (nodeId: string) => {
    const found = [...container.querySelectorAll<HTMLAnchorElement>(".missing-flows li a")].find(
      (a) => a.getAttribute("href")?.endsWith(`?node=${nodeId}`),
    );
    if (!found) throw new Error(`no link to ${nodeId}`);
    return found;
  };
  return { link };
}

describe("the missing-flow list on the atlas home", () => {
  it("names each element by its role and label, with its short ref after them", () => {
    const { link } = render(statesIndex());
    expect(container.querySelectorAll(".missing-flows li")).toHaveLength(8);
    expect(container.querySelectorAll(".missing-flows-board[open]")).toHaveLength(1);
    const item = link("confirm-import");
    expect(item.getAttribute("href")).toBe("#/board/web--users-upload?node=confirm-import");
    expect(item.title).toBe("web:users-upload/import");
    expect(item.querySelector(".missing-flows-role")?.textContent).toBe("Button");
    expect(item.querySelector(".missing-flows-label")?.textContent).toBe("Import");
    expect(item.querySelector(".missing-flows-ref")?.textContent).toBe("import");
    // The name comes from the line itself, so it holds the visible label and reads in order.
    expect(item.hasAttribute("aria-label")).toBe(false);
    expect(item.textContent).toBe("Button Import import");
    // Two buttons both labelled Cancel stay apart by their refs.
    expect(link("validating-cancel").querySelector(".missing-flows-ref")?.textContent).toBe(
      "cancel-validation",
    );
    expect(link("pick").querySelector(".missing-flows-role")?.textContent).toBe("Input");
  });

  it("translates the role tag and leaves the label as the board wrote it", () => {
    setLocale("vi");
    const { link } = render(statesIndex());
    const item = link("confirm-import");
    expect(item.querySelector(".missing-flows-role")?.textContent).toBe("Nút");
    expect(item.querySelector(".missing-flows-label")?.textContent).toBe("Import");
    setLocale("ja");
    const ja = render(statesIndex()).link("pick");
    expect(ja.querySelector(".missing-flows-role")?.textContent).toBe("入力欄");
  });

  it("falls back to the short ref when the index carries no label", () => {
    const { link } = render(withoutLabels(statesIndex()));
    const item = link("confirm-import");
    expect(item.querySelector(".missing-flows-role")).toBeNull();
    expect(item.querySelector(".missing-flows-label")?.textContent).toBe("import");
    expect(item.querySelector(".missing-flows-label")?.tagName).toBe("CODE");
    expect(item.querySelector(".missing-flows-ref")).toBeNull();
    expect(item.title).toBe("web:users-upload/import");
    expect(item.getAttribute("href")).toBe("#/board/web--users-upload?node=confirm-import");
  });
});
