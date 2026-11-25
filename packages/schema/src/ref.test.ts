import { describe, expect, test } from "vitest";
import { figmaUrl } from "./board.ts";
import {
  isChildRef,
  isScreenRef,
  parseRef,
  refNamespace,
  refToFileSlug,
  rootRefOf,
} from "./ref.ts";

describe("parseRef", () => {
  test("parses screen and element refs", () => {
    expect(parseRef("web:cart")).toEqual({
      namespace: "web",
      platform: "web",
      screen: "cart",
      screenRef: "web:cart",
    });
    expect(parseRef("mobile:order-detail/pay-button")).toEqual({
      namespace: "mobile",
      platform: "mobile",
      screen: "order-detail",
      element: "pay-button",
      screenRef: "mobile:order-detail",
    });
  });

  test.each([
    "cart",
    "web:",
    "web:Cart",
    "ios:cart",
    "web:cart/a/b",
    "web:-cart",
    "web:cart-",
    `web:${"a".repeat(61)}`,
  ])("rejects %s", (ref) => {
    expect(parseRef(ref)).toBeNull();
  });

  test("parses refs of the API, the database and the background jobs", () => {
    expect(parseRef("api:orders")).toEqual({
      namespace: "api",
      root: "orders",
      rootRef: "api:orders",
    });
    expect(parseRef("api:orders/get-id-items")).toEqual({
      namespace: "api",
      root: "orders",
      child: "get-id-items",
      rootRef: "api:orders",
    });
    expect(parseRef("db:order-items/customer-id")).toMatchObject({
      namespace: "db",
      root: "order-items",
      child: "customer-id",
    });
    expect(parseRef("batch:send-receipt")).toEqual({
      namespace: "batch",
      root: "send-receipt",
      rootRef: "batch:send-receipt",
    });
    for (const ref of ["queue:x", "api:", "db:Orders", "api:a/b/c"])
      expect(parseRef(ref)).toBeNull();
  });

  test("tells a ref's namespace, root and level", () => {
    expect(refNamespace("db:orders/id")).toBe("db");
    expect(rootRefOf("web:checkout/pay")).toBe("web:checkout");
    expect(rootRefOf("api:orders/post")).toBe("api:orders");
    expect(isChildRef("api:orders/post")).toBe(true);
    expect(isChildRef("batch:send-receipt")).toBe(false);
    expect(isScreenRef("api:orders")).toBe(false);
  });

  test("isScreenRef tells screens from elements", () => {
    expect(isScreenRef("web:cart")).toBe(true);
    expect(isScreenRef("web:cart/total")).toBe(false);
    expect(isScreenRef("nope")).toBe(false);
  });
});

describe("refToFileSlug", () => {
  test("maps refs to file slugs that cannot collide across platforms", () => {
    expect(refToFileSlug("web:cart")).toBe("web--cart");
    expect(refToFileSlug("mobile:cart")).toBe("mobile--cart");
    expect(refToFileSlug("web:checkout/pay-button")).toBe("web--checkout__pay-button");
    expect(refToFileSlug("api:orders")).toBe("api--orders");
  });
});

describe("figmaUrl", () => {
  test("builds the design URL with a hyphenated node id", () => {
    expect(figmaUrl({ fileKey: "AbCdEf0123456789", nodeId: "12:34" })).toBe(
      "https://www.figma.com/design/AbCdEf0123456789?node-id=12-34",
    );
  });
});
