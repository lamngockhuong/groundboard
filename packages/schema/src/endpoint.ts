import { REF_SLUG_MAX } from "./ref.ts";

/**
 * The slug of an endpoint's ref, from its method and path, so that a skill and validation name
 * the same endpoint the same way:
 *
 * 1. drop the resource's `pathPrefix`, then every segment up to and including the one that
 *    names the resource;
 * 2. turn each parameter into its bare name, whatever the router's syntax: `{id}`, `:id`,
 *    `<int:pk>`, `[id]`, `[...slug]`;
 * 3. lowercase, `.` and anything else outside letters and digits become `-`, joined after the
 *    method.
 *
 * `GET /v1/orders/:id/items` with prefix `/v1` in resource `orders` is `get-id-items`;
 * `POST /orders` is `post`. Null when the slug would be longer than a ref slug may be.
 */
export function endpointSlug(
  method: string,
  path: string,
  resource: string,
  pathPrefix?: string,
): string | null {
  let rest = path;
  if (pathPrefix && rest.startsWith(pathPrefix)) rest = rest.slice(pathPrefix.length);
  const segments = rest.split("/").filter((s) => s !== "");
  const named = segments.findIndex((s) => slugPart(bareParam(s)) === resource);
  const kept = named >= 0 ? segments.slice(named + 1) : segments;
  const parts = [method.toLowerCase(), ...kept.map((s) => slugPart(bareParam(s)))].filter(
    (p) => p !== "",
  );
  const slug = parts.join("-");
  return slug.length > REF_SLUG_MAX ? null : slug;
}

/** A path segment without its parameter syntax: `{id}`, `:id`, `<int:pk>`, `[...slug]` give the name. */
function bareParam(segment: string): string {
  const brace = /^\{([^}]+)\}$/.exec(segment);
  if (brace) return brace[1] as string;
  if (segment.startsWith(":")) return segment.slice(1);
  const angle = /^<(?:[^:>]+:)?([^>]+)>$/.exec(segment);
  if (angle) return angle[1] as string;
  const square = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment);
  if (square) return square[1] as string;
  return segment;
}

/** Lowercase letters and digits, single hyphens between them. */
function slugPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether `slug` is the slug the endpoint should have, or that slug with a `-2`, `-3`... suffix:
 * a static segment that reads like a parameter (`/orders/id` and `/orders/{id}`) gives the
 * same slug, and the second one takes a suffix.
 */
export function matchesEndpointSlug(slug: string, expected: string): boolean {
  if (slug === expected) return true;
  if (!slug.startsWith(`${expected}-`)) return false;
  const suffix = slug.slice(expected.length + 1);
  return /^[1-9]\d*$/.test(suffix) && suffix !== "1";
}
