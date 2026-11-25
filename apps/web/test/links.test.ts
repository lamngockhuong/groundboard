import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "../src/links.ts";

describe("safeExternalUrl", () => {
  it("allows an https GitHub blob URL", () => {
    const url = "https://github.com/lamngockhuong/groundboard/blob/abc123/src/cart.ts#L10-L20";
    expect(safeExternalUrl(url)).toBe(url);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JAVASCRIPT:alert(1)"],
    ["JaVaScRiPt:alert(document.cookie)"],
    ["  javascript:alert(1)"],
    ["\n\tjavascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://github.com/lamngockhuong/groundboard"],
    ["/relative/path"],
    ["src/cart.ts"],
    ["//evil.example/x"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    [""],
    ["   "],
  ])("refuses %j", (url) => {
    expect(safeExternalUrl(url)).toBeNull();
  });

  it("refuses null and undefined", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it("accepts an https URL with surrounding whitespace and returns it normalized", () => {
    expect(safeExternalUrl("  HTTPS://GitHub.com/a  ")).toBe("https://github.com/a");
  });
});
