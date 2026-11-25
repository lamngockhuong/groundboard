import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "../src/route.ts";

describe("parseRoute", () => {
  it("reads a board and an optional node", () => {
    expect(parseRoute("#/board/web--checkout")).toEqual({ view: "board", slug: "web--checkout" });
    expect(parseRoute("#/board/web--checkout?node=pay")).toEqual({
      view: "board",
      slug: "web--checkout",
      node: "pay",
    });
  });

  it.each([
    "",
    "#/",
    "#/board/",
    "#/board/..",
    "#/board/%2e%2e",
    "#/board/.env",
    "#/board/a.b",
    "#/board/a%2Fb",
    "#/board/%E0%A4%A",
    `#/board/${"x".repeat(101)}`,
    "#/board/ok?node=",
    "#/board/ok?node=a%20b",
    "#/board/ok?node=<script>",
    `#/board/ok?node=${"n".repeat(65)}`,
    "#/board/ok?node=a&node=b",
    "#/board/ok?other=1",
  ])("falls back to the list for %s", (hash) => {
    expect(parseRoute(hash)).toEqual({ view: "home" });
  });

  it("reads #<slug>, the only hash an Artifact keeps in a shared link", () => {
    expect(parseRoute("#web--checkout")).toEqual({ view: "board", slug: "web--checkout" });
    expect(parseRoute("#overview-web")).toEqual({ view: "board", slug: "overview-web" });
    // A leading dash, an underscore or a dot is not a short link; "#/" stays home.
    for (const hash of ["#-x", "#a_b", "#a.b", "#", "#/", `#${"x".repeat(101)}`]) {
      expect(parseRoute(hash), hash).toEqual({ view: "home" });
    }
  });

  it("writes #<slug> on an exported page when the slug survives an Artifact link", () => {
    expect(formatRoute({ view: "board", slug: "web--checkout" }, true)).toBe("#web--checkout");
    expect(formatRoute({ view: "board", slug: "web_checkout" }, true)).toBe("#/board/web_checkout");
    expect(formatRoute({ view: "board", slug: "web--checkout", node: "pay" }, true)).toBe(
      "#/board/web--checkout?node=pay",
    );
    expect(formatRoute({ view: "home" }, true)).toBe("#/");
    expect(formatRoute({ view: "board", slug: "web--checkout" })).toBe("#/board/web--checkout");
    for (const slug of ["web--checkout", "web_checkout"]) {
      const route = { view: "board" as const, slug };
      expect(parseRoute(formatRoute(route, true))).toEqual(route);
    }
  });

  it("round-trips through formatRoute", () => {
    const route = { view: "board" as const, slug: "mobile--cart", node: "web:checkout.pay_1" };
    expect(parseRoute(formatRoute(route))).toEqual(route);
    expect(formatRoute({ view: "home" })).toBe("#/");
  });
});
