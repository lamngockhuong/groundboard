import { describe, expect, it } from "vitest";
import { lintOverlayText } from "./lint-text.ts";
import { emptyOverlay, isEmptyOverlay, parseOverlay, placedUnits } from "./overlay.ts";

const note = (extra: Record<string, unknown> = {}) => ({
  id: "n1",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  ...extra,
});

describe("parseOverlay", () => {
  it("accepts offsets and notes, anchored or not", () => {
    const parsed = parseOverlay({
      schemaVersion: 1,
      nodes: { cart: { dx: 40, dy: -12 } },
      notes: [
        note(),
        note({
          id: "t",
          type: "text",
          text: "Check this",
          anchor: { nodeId: "cart", dx: 0, dy: -30 },
        }),
        note({
          id: "l",
          type: "arrow",
          points: [
            [0, 0],
            [50, 10],
          ],
          strokeColor: "#1e1e1e",
        }),
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it("refuses links, images, files and unknown fields on a note", () => {
    for (const extra of [{ link: "https://example.com" }, { fileId: "f" }, { customData: {} }]) {
      const parsed = parseOverlay({ ...emptyOverlay(), notes: [note(extra)] });
      expect(parsed.ok, JSON.stringify(extra)).toBe(false);
    }
    for (const type of ["image", "embeddable", "iframe", "frame"]) {
      expect(parseOverlay({ ...emptyOverlay(), notes: [note({ type })] }).ok, type).toBe(false);
    }
  });

  it("refuses a wrong version, huge coordinates, too many notes and repeated note ids", () => {
    expect(parseOverlay({ ...emptyOverlay(), schemaVersion: 2 }).ok).toBe(false);
    expect(parseOverlay({ ...emptyOverlay(), notes: [note({ x: 1e9 })] }).ok).toBe(false);
    const many = Array.from({ length: 501 }, (_, i) => note({ id: `n${i}` }));
    expect(parseOverlay({ ...emptyOverlay(), notes: many }).ok).toBe(false);
    const twice = parseOverlay({ ...emptyOverlay(), notes: [note(), note()] });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error[0]?.path).toBe("notes[1].id");
    expect(parseOverlay({ ...emptyOverlay(), nodes: { a: { dx: "1", dy: 0 } } }).ok).toBe(false);
  });

  it("knows an overlay that changes nothing", () => {
    expect(isEmptyOverlay(emptyOverlay())).toBe(true);
    expect(isEmptyOverlay({ ...emptyOverlay(), nodes: { a: { dx: 1, dy: 0 } } })).toBe(false);
  });
});

describe("lintOverlayText", () => {
  it("warns about personal data, local paths and secrets in note text", () => {
    const overlay = {
      ...emptyOverlay(),
      notes: [
        note({ id: "a", text: "ask jane@example.com" }),
        note({ id: "b", text: "see /home/jane/notes" }),
        note({ id: "c", text: "db at postgres://admin:hunter2@db.internal/app" }),
        // Assembled at runtime so the repository holds no string a secret scanner would report.
        note({ id: "d", text: `key ${["gh", "p_", "a1B2c3D4e5F6g7H8i9J0".repeat(2)].join("")}` }),
        note({ id: "e", text: "Placeholder: Customer email" }),
      ],
    };
    const warnings = lintOverlayText(overlay as Parameters<typeof lintOverlayText>[0]);
    expect(warnings).toHaveLength(4);
    expect(warnings[2]).toContain("a URL with a password");
    expect(warnings[3]).toContain("a GitHub token");
  });
});

describe("placedUnits", () => {
  it("moves elements with their screen, and states with their root screen", () => {
    const units = placedUnits({
      nodes: [
        {
          id: "s",
          kind: "screen",
          label: "S",
          ref: "web:s",
          platform: "web",
          layoutFrom: "code",
          sourceIds: [],
        },
        { id: "s2", kind: "screen", label: "S2", stateOf: "s", sourceIds: [] },
        { id: "b", kind: "element", label: "B", parentId: "s2", role: "button", sourceIds: [] },
        { id: "c", kind: "element", label: "C", parentId: "b", role: "text", sourceIds: [] },
        { id: "x", kind: "step", label: "X", sourceIds: [] },
      ] as never,
    });
    expect(Object.fromEntries(units)).toEqual({ s: "s", s2: "s", b: "s", c: "s", x: "x" });
  });
});
