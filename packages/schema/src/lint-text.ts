import type { Board } from "./board.ts";
import { endpointSlug, matchesEndpointSlug } from "./endpoint.ts";
import { lintFigmaSources } from "./figma.ts";
import type { Overlay } from "./overlay.ts";

/**
 * Patterns that suggest real user data or a local path was copied into a board. Boards are
 * committed, so the text a person or an agent wrote must use placeholders instead.
 * Order matters: a card-length digit run is reported as a card number, not a phone number.
 */
const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["a card number", /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/],
  ["a phone number", /(?<!\d)\+?\d(?:[ .()-]{0,2}\d){8,}(?!\d)/],
  // `/home/<name>` or `/Users/<name>` that starts a path: not a route segment such as
  // `/_authenticated/home/dashboard/`, and not a bare `/home/`.
  ["an absolute local path", /(?<![\w.~/-])\/(?:home|Users)\/[^/\s"']+|(?<![A-Za-z])[A-Za-z]:\\/],
];

const URL_PATTERNS = PATTERNS.filter(([what]) => what !== "an absolute local path");

/**
 * Patterns that suggest a secret: a URL that carries a user and password, and a long token
 * mixing letters and digits the way API keys and access tokens do.
 */
export const CREDENTIAL_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["a URL with a password", /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
  [
    "an access token",
    /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/,
  ],
];

/** Extensions of files that hold prose rather than code. */
const DOCUMENT_EXTENSIONS = /\.(?:md|mdx|txt|rst|adoc)$/i;

/** Whether a code source's path points at a document: a prose extension or a `docs/` directory. */
export function looksLikeDocument(path: string): boolean {
  return DOCUMENT_EXTENSIONS.test(path) || /(?:^|[/\\])docs[/\\]/.test(path);
}

/** The path and query of a URL, percent-decoded, so an address hidden as `%40` is still seen. */
function decodedUrlText(value: string): string {
  try {
    const url = new URL(value);
    const text = `${url.pathname} ${url.search} ${url.hash}`;
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      return text;
    }
  } catch {
    return value;
  }
}

/**
 * Warnings (not errors) for text that looks like an email, a phone number, a card number or an
 * absolute local path: in node labels, details, actions and `unresolved`, edge labels, source
 * quotes, link titles and URLs, and mockup labels. Also warns when a code source cites a
 * document, which would count a requirement as code, and when an element cites a layer of
 * another Figma file than its screen's frame, and when an edge repeats an earlier one.
 */
export function lintBoardText(board: Board): string[] {
  const warnings: string[] = [];
  const check = (
    path: string,
    text: string | undefined,
    patterns: ReadonlyArray<[string, RegExp]> = [...CREDENTIAL_PATTERNS, ...PATTERNS],
  ) => {
    if (text === undefined) return;
    for (const [what, pattern] of patterns) {
      if (pattern.test(text)) {
        warnings.push(
          `${path} looks like it contains ${what}; boards are committed, so replace real data with a placeholder such as "Customer email"`,
        );
        return;
      }
    }
  };
  board.nodes.forEach((node, i) => {
    check(`nodes[${i}].label`, node.label);
    check(`nodes[${i}].detail`, node.detail);
    check(`nodes[${i}].action`, node.action);
    check(`nodes[${i}].unresolved`, node.unresolved);
    check(`nodes[${i}].path`, node.path, [...CREDENTIAL_PATTERNS, ...URL_PATTERNS]);
    check(`nodes[${i}].trigger.schedule`, node.trigger?.schedule);
    check(`nodes[${i}].trigger.queue`, node.trigger?.queue);
    check(`nodes[${i}].trigger.event`, node.trigger?.event);
    node.columns?.forEach((column, j) => {
      const at = `nodes[${i}].columns[${j}]`;
      check(`${at}.name`, column.name);
      check(`${at}.type`, column.type);
      check(`${at}.default`, column.default);
      check(`${at}.note`, column.note);
    });
  });
  warnings.push(...lintEndpointRefs(board));
  board.edges.forEach((edge, i) => {
    check(`edges[${i}].label`, edge.label);
  });
  board.sources.forEach((source, i) => {
    const at = `sources[${i}]`;
    switch (source.kind) {
      case "code":
        check(`${at}.quote`, source.quote);
        if (looksLikeDocument(source.path)) {
          warnings.push(
            `${at}.path cites a document as code (${source.path}); use kind "doc" so it counts as a specification, not as code`,
          );
        }
        break;
      case "doc":
        check(`${at}.quote`, source.quote);
        break;
      case "link":
        check(`${at}.title`, source.title);
        check(`${at}.quote`, source.quote);
        // A URL path such as `/home/` is not a local path; check the other patterns only.
        check(`${at}.url`, source.url, CREDENTIAL_PATTERNS);
        check(`${at}.url`, decodedUrlText(source.url), URL_PATTERNS);
        break;
      case "mockup":
        check(`${at}.label`, source.label);
        break;
      case "figma":
        break;
      default: {
        const unknown: never = source;
        throw new Error(`unknown source kind ${JSON.stringify(unknown)}`);
      }
    }
  });
  warnings.push(...lintFigmaSources(board));
  warnings.push(...lintDuplicateEdges(board));
  return warnings;
}

/**
 * Warnings for edges that repeat an earlier edge: the same `from`, the same `to` or `toRef`, the
 * same kind and the same label. They draw as parallel arrows that say nothing more than one
 * arrow would; one edge whose `sourceIds` lists every call says the same.
 */
export function lintDuplicateEdges(board: Pick<Board, "edges">): string[] {
  const warnings: string[] = [];
  const first = new Map<string, number>();
  board.edges.forEach((edge, i) => {
    const target = edge.to !== undefined ? `to ${edge.to}` : `toRef ${edge.toRef}`;
    const key = JSON.stringify([edge.from, target, edge.kind, edge.label ?? ""]);
    const earlier = first.get(key);
    if (earlier === undefined) {
      first.set(key, i);
      return;
    }
    const same = board.edges[earlier] as (typeof board.edges)[number];
    warnings.push(
      `edges[${i}] (\`${edge.id}\`) repeats edges[${earlier}] (\`${same.id}\`): same from \`${edge.from}\`, ${target}, kind and label; merge them into one edge whose sourceIds lists the sources of both`,
    );
  });
  return warnings;
}

/**
 * Warnings for the text of an overlay's notes that looks like an email, a phone or card number,
 * an absolute local path or a secret. Overlays are committed beside their boards.
 */
export function lintOverlayText(overlay: Overlay): string[] {
  const warnings: string[] = [];
  overlay.notes.forEach((note, i) => {
    if (note.text === undefined) return;
    for (const [what, pattern] of [...CREDENTIAL_PATTERNS, ...PATTERNS]) {
      if (pattern.test(note.text)) {
        warnings.push(
          `notes[${i}].text looks like it contains ${what}; overlays are committed, so replace real data with a placeholder`,
        );
        return;
      }
    }
  });
  return warnings;
}

/**
 * Warnings for an endpoint whose ref is not the one its method and path give (`endpointSlug`),
 * nor that one with a `-2`, `-3`... suffix: skills name endpoints that way, and a ref written
 * otherwise is hard to point at from a screen.
 */
export function lintEndpointRefs(board: Pick<Board, "nodes">): string[] {
  const warnings: string[] = [];
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  board.nodes.forEach((node, i) => {
    if (node.kind !== "endpoint" || node.ref === undefined) return;
    if (node.method === undefined || node.path === undefined) return;
    const parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
    if (parent?.kind !== "resource" || parent.ref === undefined) return;
    if (!node.ref.startsWith(`${parent.ref}/`)) return;
    const resource = parent.ref.slice("api:".length);
    const expected = endpointSlug(node.method, node.path, resource, parent.pathPrefix);
    const slug = node.ref.slice(parent.ref.length + 1);
    if (expected !== null && !matchesEndpointSlug(slug, expected)) {
      warnings.push(
        `nodes[${i}].ref \`${node.ref}\` differs from \`${parent.ref}/${expected}\`, the ref its method and path give`,
      );
    }
  });
  return warnings;
}
