import { isStaticMode } from "./mode.ts";

/**
 * Deep links into the atlas: `#/board/<slug>?node=<nodeId>`, and the short `#<slug>` that a
 * Claude Artifact keeps in a shared link (it drops any hash but letters, digits and dashes). Both parts are checked with the
 * server's rules, so a hand-edited or forged link falls back to the board list instead of
 * reaching the server with something it would refuse anyway.
 */

/** Same rule as the server's board slug: no dots, so never `..` or `.env`. */
export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** Same rule as a board id in the schema. */
export const NODE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A slug that survives an Artifact's shared link as `#<slug>`. */
const SHORT_SLUG = /^[A-Za-z0-9-]+$/;

export type Route = { view: "home" } | { view: "board"; slug: string; node?: string };

const HOME: Route = { view: "home" };

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const short = hash.slice(1);
  if (hash.startsWith("#") && SHORT_SLUG.test(short) && SLUG_PATTERN.test(short)) {
    return { view: "board", slug: short };
  }
  const match = /^#\/board\/([^?]+)(?:\?(.*))?$/.exec(hash);
  if (!match) return HOME;
  const slug = decode(match[1] as string);
  if (slug === null || !SLUG_PATTERN.test(slug)) return HOME;
  if (match[2] === undefined) return { view: "board", slug };
  const params = new URLSearchParams(match[2]);
  const keys = [...params.keys()];
  const node = params.get("node");
  if (keys.length !== 1 || node === null || !NODE_ID_PATTERN.test(node)) return HOME;
  return { view: "board", slug, node };
}

/**
 * The hash for a route. On an exported page a board without a node is written `#<slug>`, so a
 * shared Artifact link keeps it; anything else keeps the `#/board/` form.
 */
export function formatRoute(route: Route, staticMode = isStaticMode()): string {
  if (route.view === "home") return "#/";
  if (staticMode && route.node === undefined && SHORT_SLUG.test(route.slug)) {
    return `#${route.slug}`;
  }
  const base = `#/board/${encodeURIComponent(route.slug)}`;
  return route.node === undefined ? base : `${base}?node=${encodeURIComponent(route.node)}`;
}
