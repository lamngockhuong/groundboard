import { describe, expect, test } from "vitest";
import { privatePackageNames, privatePackagePattern } from "./private-packages.mjs";

describe("private workspace packages", () => {
  test("are read from the package.json files, and published packages are not among them", () => {
    const names = privatePackageNames();
    expect(names).toContain("@groundboard/schema");
    expect(names).toContain("@groundboard/web");
    expect(names).not.toContain("@groundboard/png");
    expect(names).not.toContain("groundboard");
  });

  test("the pattern matches a private package and its subpaths only", () => {
    const pattern = privatePackagePattern(["@groundboard/layout"]);
    expect(pattern.test("@groundboard/layout")).toBe(true);
    expect(pattern.test("@groundboard/layout/overlay")).toBe(true);
    expect(pattern.test("@groundboard/layouts")).toBe(false);
    expect(pattern.test("@groundboard/png")).toBe(false);
  });
});
