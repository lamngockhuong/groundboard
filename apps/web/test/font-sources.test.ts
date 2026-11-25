import { describe, expect, it } from "vitest";
import { installFontSourceFilter, withoutCdnSources } from "../src/font-sources.ts";

const local = "url(http://127.0.0.1:8991/fonts/Virgil/Virgil-Regular.woff2) format('woff2')";
const cdn =
  "url(https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/Virgil/Virgil-Regular.woff2) format('woff2')";

describe("withoutCdnSources", () => {
  it("drops the esm.sh fallback when a local source is listed", () => {
    expect(withoutCdnSources(`${local}, ${cdn}`)).toBe(local);
  });

  it("keeps a CDN-only source so an unshipped family still has something to load", () => {
    expect(withoutCdnSources(cdn)).toBe(cdn);
  });

  it("leaves sources without a CDN entry untouched", () => {
    expect(withoutCdnSources(local)).toBe(local);
    expect(withoutCdnSources("local(Arial)")).toBe("local(Arial)");
  });

  it("does not split on commas inside url()", () => {
    const comma = "url(data:font/woff2;base64,AAAA) format('woff2')";
    expect(withoutCdnSources(`${comma}, ${cdn}`)).toBe(comma);
  });
});

describe("installFontSourceFilter", () => {
  class FakeFontFace {
    family: string;
    source: unknown;
    descriptors?: unknown;
    constructor(family: string, source: unknown, descriptors?: unknown) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
    }
  }

  it("filters string sources and passes the rest through", () => {
    const target = { FontFace: FakeFontFace as unknown as typeof FontFace };
    installFontSourceFilter(target);
    const face = new target.FontFace("Virgil", `${local}, ${cdn}`, { weight: "400" });
    expect(face).toBeInstanceOf(FakeFontFace);
    expect((face as unknown as FakeFontFace).source).toBe(local);
    expect((face as unknown as FakeFontFace).descriptors).toEqual({ weight: "400" });

    const buffer = new ArrayBuffer(4);
    expect((new target.FontFace("X", buffer) as unknown as FakeFontFace).source).toBe(buffer);
  });

  it("wraps only once", () => {
    const target = { FontFace: FakeFontFace as unknown as typeof FontFace };
    installFontSourceFilter(target);
    const first = target.FontFace;
    installFontSourceFilter(target);
    expect(target.FontFace).toBe(first);
  });
});
