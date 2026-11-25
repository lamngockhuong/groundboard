/**
 * Atlas references name something defined on one board and pointed at from others.
 *
 * - screen: `<platform>:<screen-slug>`, e.g. `web:cart`
 * - element: `<screen-ref>/<element-slug>`, e.g. `web:checkout/pay-button`
 * - API resource and endpoint: `api:<resource>`, `api:<resource>/<endpoint-slug>`
 * - database table and column: `db:<table>`, `db:<table>/<column-slug>`
 * - background job: `batch:<job>`
 *
 * At most two levels. Slugs are lowercase words joined by single hyphens, at most 60 characters.
 */

/** Platforms a screen is drawn for; also the namespaces of screen refs. */
export const PLATFORMS = ["web", "mobile"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Every namespace a ref may start with. */
export const REF_NAMESPACES = ["web", "mobile", "api", "db", "batch"] as const;
export type RefNamespace = (typeof REF_NAMESPACES)[number];

export const REF_SLUG_MAX = 60;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAMESPACE = REF_NAMESPACES.join("|");
const ROOT_REF = new RegExp(`^(${NAMESPACE}):(${SLUG})$`);
const CHILD_REF = new RegExp(`^(${NAMESPACE}):(${SLUG})/(${SLUG})$`);

/** The namespaces as the ref syntax writes them: `<web|mobile|api|db|batch>`. */
export const REF_NAMESPACE_SYNTAX = `<${REF_NAMESPACES.join("|")}>`;

/** A screen or element ref. */
export interface ScreenRefParts {
  namespace: Platform;
  platform: Platform;
  screen: string;
  /** Present for an element ref. */
  element?: string;
  /** The screen part of the ref, e.g. `web:checkout` for `web:checkout/pay-button`. */
  screenRef: string;
}

/** A ref of the API, the database or the background jobs. */
export interface OtherRefParts {
  namespace: Exclude<RefNamespace, Platform>;
  /** The resource, table or job. */
  root: string;
  /** Present for an endpoint or a column. */
  child?: string;
  /** The root part of the ref, e.g. `api:orders` for `api:orders/get-id`. */
  rootRef: string;
}

export type ParsedRef = ScreenRefParts | OtherRefParts;

const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as readonly string[]).includes(value);

/** Parses a ref; returns null when the syntax or a slug length is wrong. */
export function parseRef(ref: string): ParsedRef | null {
  const child = CHILD_REF.exec(ref);
  const match = child ?? ROOT_REF.exec(ref);
  if (!match) return null;
  const namespace = match[1] as RefNamespace;
  const root = match[2] as string;
  const childSlug = child ? (match[3] as string) : undefined;
  if (root.length > REF_SLUG_MAX) return null;
  if (childSlug !== undefined && childSlug.length > REF_SLUG_MAX) return null;
  if (isPlatform(namespace)) {
    return {
      namespace,
      platform: namespace,
      screen: root,
      ...(childSlug !== undefined ? { element: childSlug } : {}),
      screenRef: `${namespace}:${root}`,
    };
  }
  return {
    namespace,
    root,
    ...(childSlug !== undefined ? { child: childSlug } : {}),
    rootRef: `${namespace}:${root}`,
  };
}

/** Whether a ref names a screen: a platform namespace and no element. */
export function isScreenRef(ref: string): boolean {
  const parsed = parseRef(ref);
  return parsed !== null && "platform" in parsed && parsed.element === undefined;
}

/** The namespace of a ref, or null when it is not a ref. */
export function refNamespace(ref: string): RefNamespace | null {
  return parseRef(ref)?.namespace ?? null;
}

/** The first level of a ref: the screen, resource, table or job it belongs to. */
export function rootRefOf(ref: string): string | null {
  const parsed = parseRef(ref);
  if (parsed === null) return null;
  return "platform" in parsed ? parsed.screenRef : parsed.rootRef;
}

/** Whether a ref has a second level: an element, an endpoint or a column. */
export function isChildRef(ref: string): boolean {
  const parsed = parseRef(ref);
  if (parsed === null) return false;
  return "platform" in parsed ? parsed.element !== undefined : parsed.child !== undefined;
}

/**
 * The board file slug for a ref: `:` becomes `--` and `/` becomes `__`.
 * `web:cart` → `web--cart`, `web:checkout/pay-button` → `web--checkout__pay-button`.
 * Skills, the atlas index and the server all name screen boards with this.
 */
export function refToFileSlug(ref: string): string {
  return ref.replace(":", "--").replace("/", "__");
}
