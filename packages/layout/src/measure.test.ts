import { describe, expect, test } from "vitest";
import { LINE_HEIGHT, lineWidth, measureText, WIDTH_SAFETY, wrapText } from "./measure.ts";
import { FONT_SIZE, MAX_TEXT_WIDTH, nodeText } from "./text.ts";

describe("measure", () => {
  test("measures with the font table and a safety margin", () => {
    const narrow = lineWidth("iiii", FONT_SIZE);
    const wide = lineWidth("WWWW", FONT_SIZE);
    expect(wide).toBeGreaterThan(narrow * 2);
    const size = measureText("ab\ncd", 20);
    expect(size.height).toBe(Math.ceil(2 * 20 * LINE_HEIGHT));
    expect(size.width).toBe(
      Math.ceil(Math.max(lineWidth("ab", 20), lineWidth("cd", 20)) * WIDTH_SAFETY),
    );
  });

  test("counts characters the font lacks as one em", () => {
    expect(lineWidth("漢字", 16)).toBe(32);
  });
});

describe("wrapText", () => {
  const widest = (text: string) =>
    Math.max(...text.split("\n").map((l) => lineWidth(l, FONT_SIZE) * WIDTH_SAFETY));

  test("wraps on word boundaries within the max width", () => {
    const text = wrapText(
      "Authorize the card before reserving stock so a declined card never holds inventory",
      MAX_TEXT_WIDTH,
      FONT_SIZE,
    );
    expect(text.split("\n").length).toBeGreaterThan(1);
    expect(widest(text)).toBeLessThanOrEqual(MAX_TEXT_WIDTH);
    expect(text.replaceAll("\n", " ")).toBe(
      "Authorize the card before reserving stock so a declined card never holds inventory",
    );
  });

  test("keeps explicit line breaks", () => {
    expect(wrapText("a\nb", MAX_TEXT_WIDTH, FONT_SIZE)).toBe("a\nb");
  });

  test("wraps CJK text per character", () => {
    const text = wrapText("漢".repeat(40), MAX_TEXT_WIDTH, FONT_SIZE);
    expect(text.split("\n").length).toBeGreaterThan(1);
    expect(widest(text)).toBeLessThanOrEqual(MAX_TEXT_WIDTH);
  });

  test("breaks a long path after a slash", () => {
    const text = wrapText(
      "packages/render-excalidraw/src/some/deeply/nested/module/file-name.ts:120",
      MAX_TEXT_WIDTH,
      FONT_SIZE,
    );
    for (const line of text.split("\n").slice(0, -1)) expect(line.endsWith("/")).toBe(true);
    expect(widest(text)).toBeLessThanOrEqual(MAX_TEXT_WIDTH);
  });
});

describe("nodeText", () => {
  test("is the label alone, never a citation", () => {
    expect(nodeText({ label: "Do it" })).toBe("Do it");
    const long = nodeText({
      label: "Checkout requirements agreed with the client in the October workshop, revision 4",
    });
    expect(long).toContain("\n");
    expect(long.replace(/\n/g, " ")).toBe(
      "Checkout requirements agreed with the client in the October workshop, revision 4",
    );
    expect(measureText(long, FONT_SIZE).width).toBeLessThanOrEqual(MAX_TEXT_WIDTH);
  });
});
