import {
  boardClaims,
  boardKindOf,
  countGrounding,
  isCheckable,
  lintBoardText,
  type NodeKind,
  parseBoard,
  refProblems,
  refsOf,
} from "@groundboard/schema";
import type { AtlasBoard, AtlasBoardKind, AtlasIndex, AtlasRef } from "./api.ts";
import type { LibraryEntry } from "./library.ts";
import { SLUG_PATTERN } from "./route.ts";

/** Most spec-only paths an index entry lists, as the server's atlas does. */
const MAX_SPEC_ONLY_PATHS = 50;

const FILE_SUFFIXES = [".board.json", ".excalidraw.json", ".excalidraw", ".json"];

/**
 * The slug a board is listed under: its file name without the suffix, or its title when it was
 * pasted, reduced to the characters a slug may hold. The same file opened again gets the same
 * slug, so it replaces the copy in the list.
 */
export function slugFor(fileName: string | undefined, title: string): string {
  let base = fileName ?? "";
  const lower = base.toLowerCase();
  const suffix = FILE_SUFFIXES.find((s) => lower.endsWith(s));
  if (suffix) base = base.slice(0, -suffix.length);
  if (base.trim() === "") base = title;
  const slug = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return SLUG_PATTERN.test(slug) ? slug : "board";
}

/** The title an entry is listed under, before it is parsed. */
export function entryTitle(entry: LibraryEntry): string {
  if (entry.input.type === "scene") return entry.input.title;
  const title = entry.input.board.title;
  return typeof title === "string" && title.trim() !== "" ? title.slice(0, 300) : entry.slug;
}

const EMPTY: Omit<AtlasBoard, "slug" | "title" | "kind" | "status"> = {
  layoutFrom: [],
  tags: [],
  uncheckedSources: 0,
  grounding: { code: 0, spec: 0, none: 0 },
  specOnly: [],
  specOnlyTruncated: false,
  staleSourceIds: [],
  warnings: [],
  issues: [],
};

/**
 * The atlas index of the boards opened in the browser, built as the server builds one from a
 * `.groundboard/` directory, but without a source check: no repository is there to read. A
 * board is `ok` when it is valid and `invalid` otherwise; an Excalidraw scene is listed as a flow.
 */
export function buildLibraryIndex(entries: readonly LibraryEntry[]): AtlasIndex {
  const sorted = [...entries].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const boards: AtlasBoard[] = [];
  const refs = new Map<string, AtlasRef>();
  const refEntry = (ref: string) => {
    let entry = refs.get(ref);
    if (!entry) {
      entry = { ref, definedIn: [], usedIn: [] };
      refs.set(ref, entry);
    }
    return entry;
  };

  /** The kind of each valid board, and of each node that defines a ref, for the ref checks. */
  const kinds = new Map<string, AtlasBoardKind>();
  const definerKinds = new Map<string, NodeKind | undefined>();
  for (const entry of sorted) {
    const { slug } = entry;
    const title = entryTitle(entry);
    if (entry.input.type === "scene") {
      boards.push({ ...EMPTY, slug, title, kind: "flow", status: "ok" });
      continue;
    }
    const parsed = parseBoard(entry.input.board);
    if (!parsed.ok) {
      boards.push({ ...EMPTY, slug, title, kind: "flow", status: "invalid", issues: parsed.error });
      continue;
    }
    const board = parsed.value;
    const layoutFrom: string[] = [];
    for (const node of board.nodes) {
      if (node.layoutFrom !== undefined && !layoutFrom.includes(node.layoutFrom)) {
        layoutFrom.push(node.layoutFrom);
      }
    }
    const claims = boardClaims(board);
    const specOnly = claims.filter((c) => c.grounding === "spec").map((c) => c.path);
    boards.push({
      ...EMPTY,
      slug,
      title: board.title,
      kind: boardKindOf(board),
      status: "ok",
      layoutFrom,
      tags: [...new Set(board.tags ?? [])],
      uncheckedSources: board.sources.filter((s) => !isCheckable(s)).length,
      grounding: countGrounding(claims),
      specOnly: specOnly.slice(0, MAX_SPEC_ONLY_PATHS),
      specOnlyTruncated: specOnly.length > MAX_SPEC_ONLY_PATHS,
      warnings: lintBoardText(board),
    });
    kinds.set(slug, boardKindOf(board));
    const { defined, used } = refsOf(board);
    for (const place of defined) {
      refEntry(place.ref).definedIn.push({ slug, nodeId: place.nodeId });
      definerKinds.set(`${place.ref} ${slug} ${place.nodeId}`, place.kind);
      if (place.needsFlow) refEntry(place.ref).needsFlow = true;
    }
    for (const place of used) {
      refEntry(place.ref).usedIn.push({
        slug,
        nodeId: place.nodeId,
        ...(place.edgeId !== undefined ? { edgeId: place.edgeId } : {}),
      });
    }
  }

  const sortedRefs = [...refs.values()].sort((a, b) =>
    a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
  );
  // The same checks as the server's: a dangling ref, a ref defined twice.
  const problems = refProblems(
    sortedRefs.map((r) => ({
      ...r,
      definedIn: r.definedIn.map((d) => ({
        ...d,
        kind: definerKinds.get(`${r.ref} ${d.slug} ${d.nodeId}`),
      })),
    })),
    (slug) => kinds.get(slug),
  );
  return { boards, refs: sortedRefs, problems };
}
