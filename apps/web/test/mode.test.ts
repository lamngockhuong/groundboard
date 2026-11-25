import { describe, expect, it } from "vitest";
import { isStaticMode } from "../src/mode.ts";

const page = (head: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head></html>`, "text/html");

describe("isStaticMode", () => {
  it("is true only with the export's meta tag", () => {
    expect(isStaticMode(page('<meta name="groundboard:mode" content="static">'))).toBe(true);
    expect(isStaticMode(page(""))).toBe(false);
    expect(isStaticMode(page('<meta name="groundboard:mode" content="server">'))).toBe(false);
    expect(isStaticMode(page('<meta name="description" content="static">'))).toBe(false);
  });

  it("reads the page itself, which the tests never mark", () => {
    expect(isStaticMode()).toBe(false);
  });
});
