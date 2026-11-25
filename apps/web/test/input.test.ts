import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInput } from "../src/input.ts";

const example = readFileSync(
  join(import.meta.dirname, "../../../examples/checkout-flow.board.json"),
  "utf8",
);

describe("parseInput", () => {
  it("loads an Excalidraw document directly as a scene", () => {
    const text = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [{ id: "a", type: "rectangle" }],
      appState: { viewBackgroundColor: "#fff" },
      files: {},
    });
    const parsed = parseInput(text);
    expect(parsed.kind).toBe("scene");
    if (parsed.kind !== "scene") return;
    expect(parsed.scene.elements).toHaveLength(1);
    expect(parsed.scene.appState).toEqual({ viewBackgroundColor: "#fff" });
  });

  it("fills missing appState and files of a scene", () => {
    const parsed = parseInput('{"type":"excalidraw","elements":[]}');
    expect(parsed).toEqual({ kind: "scene", scene: { elements: [], appState: {}, files: {} } });
  });

  it("rejects an Excalidraw document without elements", () => {
    expect(parseInput('{"type":"excalidraw"}').kind).toBe("error");
  });

  it("treats the example board as IR to render", () => {
    const parsed = parseInput(example);
    expect(parsed.kind).toBe("board");
    if (parsed.kind !== "board") return;
    expect(parsed.board.title).toBe("Checkout flow");
  });

  it("treats objects with any other type as IR, leaving validation to the server", () => {
    expect(parseInput('{"type":"something-else"}').kind).toBe("board");
  });

  it.each([
    ["", "empty"],
    ["not json", "not valid JSON"],
    ["[1,2]", "JSON object"],
    ["42", "JSON object"],
    ["null", "JSON object"],
  ])("reports %j as an error", (text, fragment) => {
    const parsed = parseInput(text);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.message).toContain(fragment);
  });
});

describe("links in loaded scenes", () => {
  it("keeps https links and drops every other scheme", () => {
    const parsed = parseInput(
      JSON.stringify({
        type: "excalidraw",
        elements: [
          { id: "a", link: "https://github.com/o/r/blob/abc/x.ts#L1" },
          { id: "b", link: "javascript:alert(1)" },
          { id: "c", link: "http://example.com" },
          { id: "d", link: null },
        ],
      }),
    );
    expect(parsed.kind).toBe("scene");
    if (parsed.kind !== "scene") return;
    expect(parsed.scene.elements.map((e) => (e as { link: unknown }).link)).toEqual([
      "https://github.com/o/r/blob/abc/x.ts#L1",
      null,
      null,
      null,
    ]);
  });
});
