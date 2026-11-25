import { expect, test } from "vitest";
import { addressKey, clientKey, RateLimiter, trustedProxies } from "./rate-limit.ts";

test("IPv6 addresses are keyed by /64, IPv4 as is", () => {
  expect(addressKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
  expect(addressKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
  expect(addressKey("::1")).toBe("0:0:0:0::/64");
  expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
  expect(clientKey("::ffff:203.0.113.7", undefined, undefined)).toBe("203.0.113.7");
});

test("the limiter evicts the least recently seen key", () => {
  let now = 0;
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => now });
  expect(limiter.hit("a")).toBe(true);
  expect(limiter.hit("b")).toBe(true);
  expect(limiter.hit("c")).toBe(true);
  expect(limiter.size).toBe(2);
  expect(limiter.hit("a")).toBe(true); // "a" was evicted, so it starts a new window
  now = 2000;
  expect(limiter.hit("c")).toBe(true);
});

test("rejects an invalid --trust-proxy value", () => {
  expect(() => trustedProxies(["not-an-ip"])).toThrow(/not an IP/);
  expect(() => trustedProxies(["10.0.0.0/33"])).toThrow(/prefix/);
});
