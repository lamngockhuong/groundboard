import { describe, expect, it } from "vitest";
import { cleanTag, MAX_TAG_LENGTH } from "../src/components/TagEditor.tsx";

describe("cleanTag", () => {
  it("keeps one line with no space around it", () => {
    expect(cleanTag("  người   tham\ngia ")).toBe("người tham gia");
    expect(cleanTag("受給権者")).toBe("受給権者");
  });

  it("refuses an empty or a too long tag", () => {
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag("x".repeat(MAX_TAG_LENGTH + 1))).toBeNull();
    expect(cleanTag("x".repeat(MAX_TAG_LENGTH))).toHaveLength(MAX_TAG_LENGTH);
  });
});
