import { describe, expect, test } from "vitest";
import { endpointSlug, matchesEndpointSlug } from "./endpoint.ts";

describe("endpointSlug", () => {
  test.each([
    ["GET", "/v1/orders/:id/items", "orders", "/v1", "get-id-items"],
    ["POST", "/orders", "orders", undefined, "post"],
    ["GET", "/orders/{orderId}", "orders", undefined, "get-orderid"],
    ["DELETE", "/api/orders/<int:pk>", "orders", undefined, "delete-pk"],
    ["GET", "/orders/[id]/receipt.pdf", "orders", undefined, "get-id-receipt-pdf"],
    ["GET", "/docs/[...slug]", "docs", undefined, "get-slug"],
    ["PATCH", "/users/me", "orders", undefined, "patch-users-me"],
  ])("%s %s in %s is %s", (method, path, resource, prefix, expected) => {
    expect(endpointSlug(method, path, resource, prefix)).toBe(expected);
  });

  test("gives up past the slug limit", () => {
    expect(endpointSlug("GET", `/orders/${"a".repeat(70)}`, "orders")).toBeNull();
  });

  test("accepts the suffix a second endpoint of the same slug takes", () => {
    expect(matchesEndpointSlug("get-id", "get-id")).toBe(true);
    expect(matchesEndpointSlug("get-id-2", "get-id")).toBe(true);
    expect(matchesEndpointSlug("get-id-1", "get-id")).toBe(false);
    expect(matchesEndpointSlug("get-other", "get-id")).toBe(false);
  });
});
