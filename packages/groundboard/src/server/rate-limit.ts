import { BlockList, isIP } from "node:net";

export interface RateLimiterOptions {
  /** Requests allowed per key per window. */
  limit: number;
  windowMs: number;
  /** Most keys remembered; the least recently seen key is evicted first. */
  maxKeys: number;
  now?: () => number;
}

interface Window {
  start: number;
  count: number;
}

/** Fixed-window counter per client key, held in a bounded LRU map. */
export class RateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #options: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions) {
    this.#options = { now: Date.now, ...options };
  }

  get size(): number {
    return this.#windows.size;
  }

  /** Counts one request; returns false when the key is over its limit for this window. */
  hit(key: string): boolean {
    const now = this.#options.now();
    let window = this.#windows.get(key);
    if (window === undefined || now - window.start >= this.#options.windowMs) {
      window = { start: now, count: 0 };
    }
    window.count += 1;
    // Re-insert so the map's order tracks recency.
    this.#windows.delete(key);
    this.#windows.set(key, window);
    while (this.#windows.size > this.#options.maxKeys) {
      const oldest = this.#windows.keys().next().value as string;
      this.#windows.delete(oldest);
    }
    return window.count <= this.#options.limit;
  }
}

function normalise(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? (mapped[1] as string) : address;
}

/**
 * The rate-limit key for an address: IPv4 as is, IPv6 by its /64 prefix, since one host
 * usually owns a whole /64 and could otherwise rotate addresses for a fresh budget.
 */
export function addressKey(address: string): string {
  if (isIP(address) !== 6 || address.includes(".")) return address;
  const [head = "", tail = ""] = address.toLowerCase().split("::");
  const left = head === "" ? [] : head.split(":");
  const right = address.includes("::") ? (tail === "" ? [] : tail.split(":")) : [];
  const groups = address.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Parses `--trust-proxy` CIDRs (`10.0.0.0/8`, `::1/128`, or a bare address). */
export function trustedProxies(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address = "", prefixText] = cidr.split("/");
    const family = isIP(address);
    if (family === 0)
      throw new Error(`--trust-proxy: ${JSON.stringify(cidr)} is not an IP address or CIDR`);
    const type = family === 4 ? "ipv4" : "ipv6";
    const max = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`--trust-proxy: ${JSON.stringify(cidr)} has an invalid prefix length`);
    }
    list.addSubnet(address, prefix, type);
  }
  return list;
}

function isTrusted(list: BlockList, address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The address a request is rate-limited by: the socket's peer, or, when that peer is a trusted
 * proxy, the nearest address in `X-Forwarded-For` that is not itself a trusted proxy.
 */
export function clientKey(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trusted: BlockList | undefined,
): string {
  const peer = normalise(socketAddress ?? "unknown");
  if (!trusted || !forwardedFor || !isTrusted(trusted, peer)) return addressKey(peer);
  const hops = forwardedFor
    .split(",")
    .map((h) => normalise(h.trim()))
    .filter((h) => h !== "");
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (isIP(hop) === 0) return addressKey(peer);
    if (!isTrusted(trusted, hop)) return addressKey(hop);
  }
  return addressKey(hops[0] ?? peer);
}
