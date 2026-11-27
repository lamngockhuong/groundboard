import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  type AtlasBoardKind,
  type Board,
  boardClaims,
  boardKindOf,
  countGrounding,
  type Grounding,
  type Issue,
  isCheckable,
  type LayoutOrigin,
  lintBoardText,
  lintOverlayText,
  missingFlowRefs,
  type NodeKind,
  overlayOrphans,
  parseBoard,
  refProblems,
  refsOf,
  unlinkedFlowElements,
} from "@groundboard/schema";
import { checkSources } from "./check-sources.ts";
import {
  BOARD_FILE_SUFFIX,
  createSourceReader,
  listBoardFiles,
  readConfined,
} from "./fs-confined.ts";
import { listOverlaySlugs, OVERLAY_FILE_SUFFIX, readOverlayFile } from "./overlay-file.ts";

/**
 * Tells atlases apart on one origin, so the viewer keeps each one's drafts apart: a hash of the
 * root's real path, which says nothing about the path itself.
 */
export function atlasIdOf(realRoot: string): string {
  return createHash("sha256").update(`groundboard-atlas:${realRoot}`).digest("hex").slice(0, 32);
}

/** A board slug: the file name without `.board.json`. No dots, so never `..` or `.env`. */
export const BOARD_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** Most boards one atlas reads. */
export const MAX_ATLAS_BOARDS = 200;
/** Largest board file the atlas reads. */
export const MAX_BOARD_FILE_BYTES = 8 * 1024 * 1024;
/** Bytes one atlas build may read across all boards and the source files they cite. */
export const MAX_ATLAS_BYTES = 256 * 1024 * 1024;

/** Most JSON paths of spec-only claims an atlas entry lists. */
export const MAX_SPEC_ONLY_PATHS = 50;
/** Most JSON paths a `--require` problem lists. */
export const MAX_REQUIRE_PATHS = 10;
/** Most refs or elements a missing-flow warning lists. */
export const MAX_MISSING_FLOW_REFS = 5;

export type { AtlasBoardKind };
/** The least grounding every claim must have: code, or at least a specification. */
export type AtlasRequire = "code" | "spec";
export type AtlasBoardStatus = "ok" | "stale" | "invalid";

export interface AtlasBoardEntry {
  slug: string;
  title: string;
  /** Has elements → screen; has screens only → overview; otherwise flow. */
  kind: AtlasBoardKind;
  status: AtlasBoardStatus;
  /** Schema issues (invalid) or source-check issues (stale). */
  issues: Issue[];
  /** Ids of the sources whose check failed (stale boards). */
  staleSourceIds: string[];
  /** Includes the warnings of `lintBoardText` about text that looks like real data. */
  warnings: string[];
  /** Sources that cannot be checked offline: Figma, links, and mockups without a file. */
  uncheckedSources: number;
  layoutFrom: LayoutOrigin[];
  /** The board's tags, in the order it lists them; empty when it has none or is invalid. */
  tags: string[];
  /** How many claims (screens, interactive elements, grounded nodes, navigates edges) sit at each grounding. */
  grounding: Record<Grounding, number>;
  /** JSON paths of the claims backed by the specification only, at most `MAX_SPEC_ONLY_PATHS`. */
  specOnly: string[];
  /** Set when there were more spec-only claims than `specOnly` lists. */
  specOnlyTruncated: boolean;
  /**
   * Claims a person added or reworded in the viewer (`manual`), as `<path> (<id>)`: not checked
   * against any source. Absent when there are none.
   */
  manual?: string[];
}

export interface AtlasPlace {
  slug: string;
  nodeId: string;
}

export interface AtlasRef {
  ref: string;
  definedIn: Array<AtlasPlace & { kind: NodeKind }>;
  /** Nodes that carry the ref without defining it, and `toRef` edges (their `from` node). */
  usedIn: Array<AtlasPlace & { edgeId?: string }>;
  /** An element that calls an API or changes state, so a flow should cover it. */
  needsFlow?: true;
}

export interface AtlasIndex {
  boards: AtlasBoardEntry[];
  refs: AtlasRef[];
  /** Dangling and duplicate refs, skipped files, and limits reached. */
  problems: Issue[];
  /** Things worth a look that are not problems: an overlay with no board. Absent when none. */
  warnings?: string[];
}

export interface BuildAtlasOptions {
  maxBytes?: number;
  /** Report every board with a claim below this grounding as a problem. */
  require?: AtlasRequire;
  /**
   * A copy of the atlas taken before an update. Every node id, edge id and ref of a board in it
   * that the board of the same slug no longer has, and every board that is gone, is a problem.
   */
  baselineDir?: string;
}

const BELOW: Record<AtlasRequire, ReadonlySet<Grounding>> = {
  code: new Set<Grounding>(["spec", "none"]),
  spec: new Set<Grounding>(["none"]),
};

/** Node ids, edge ids and refs (defined, referred to, and `toRef`) of a board. */
function identities(board: Board): { nodes: Set<string>; edges: Set<string>; refs: Set<string> } {
  const { defined, used } = refsOf(board);
  const refs = new Set([...defined, ...used].map((place) => place.ref));
  return {
    nodes: new Set(board.nodes.map((n) => n.id)),
    edges: new Set(board.edges.map((e) => e.id)),
    refs,
  };
}

const listed = (values: string[]) => values.map((v) => `\`${v}\``).join(", ");

/** A shortened list followed by how many were left out, if any. */
const firstFew = (shown: string, total: number) =>
  total > MAX_MISSING_FLOW_REFS ? `${shown}, and ${total - MAX_MISSING_FLOW_REFS} more` : shown;

/**
 * The ids of the sources named by source-check issues (`sources[3].quote` → the id of source 3),
 * in board order. Lets a caller say which citations broke without repeating why.
 */
export function staleSourceIds(
  issues: Issue[],
  sources: ReadonlyArray<{ id?: unknown }>,
): string[] {
  const ids = new Set<string>();
  for (const issue of issues) {
    const index = /^sources\[(\d+)\]/.exec(issue.path)?.[1];
    const id = index === undefined ? undefined : sources[Number(index)]?.id;
    if (typeof id === "string") ids.add(id);
  }
  return [...ids];
}

/**
 * Builds the atlas index from the `*.board.json` files directly in `dir`, checking every code
 * source against the files under `root`. Nothing is cached: each call reads the files again,
 * so a source edited since a board was written shows up as stale at once. Boards are read in
 * slug order with one file cache and one byte budget, so the result does not depend on the
 * order the directory lists them in.
 */
export async function buildAtlas(
  dir: string,
  root: string,
  options: BuildAtlasOptions = {},
): Promise<AtlasIndex> {
  const realDir = await realpath(dir);
  const realRoot = await realpath(root);
  if (!(await stat(realRoot)).isDirectory()) throw new Error("the source root is not a directory");
  const budget = { remaining: options.maxBytes ?? MAX_ATLAS_BYTES };
  const reader = createSourceReader(realRoot, budget);

  const problems: Issue[] = [];
  const slugs: string[] = [];
  for (const name of await listBoardFiles(realDir)) {
    const slug = name.slice(0, -BOARD_FILE_SUFFIX.length);
    if (!BOARD_SLUG.test(slug)) {
      problems.push({
        path: name,
        message: `ignored: a board file name must be letters, digits, '_' or '-' (at most 100) followed by ${BOARD_FILE_SUFFIX}`,
      });
      continue;
    }
    slugs.push(slug);
  }
  if (slugs.length > MAX_ATLAS_BOARDS) {
    problems.push({
      path: "",
      message: `the atlas has ${slugs.length} boards; only the first ${MAX_ATLAS_BOARDS} by name were read`,
    });
    slugs.length = MAX_ATLAS_BOARDS;
  }

  const boards: AtlasBoardEntry[] = [];
  const refs = new Map<string, AtlasRef>();
  const refEntry = (ref: string) => {
    let entry = refs.get(ref);
    if (!entry) {
      entry = { ref, definedIn: [], usedIn: [] };
      refs.set(ref, entry);
    }
    return entry;
  };
  const kinds = new Map<string, AtlasBoardKind>();
  /** The valid boards read, by slug, for the baseline comparison. */
  const parsedBoards = new Map<string, Board>();
  /** Elements that call an API or change state but carry no ref, as `slug (node id)`. */
  const unlinked: string[] = [];

  for (const slug of slugs) {
    const invalid = (issues: Issue[], title = slug): AtlasBoardEntry => ({
      slug,
      title,
      kind: "flow",
      status: "invalid",
      issues,
      staleSourceIds: [],
      warnings: [],
      uncheckedSources: 0,
      layoutFrom: [],
      tags: [],
      grounding: { code: 0, spec: 0, none: 0 },
      specOnly: [],
      specOnlyTruncated: false,
    });
    const read = await readConfined(
      realDir,
      `${slug}${BOARD_FILE_SUFFIX}`,
      budget,
      MAX_BOARD_FILE_BYTES,
      { noSymlink: true },
    );
    if (!read.ok) {
      boards.push(invalid([{ path: "", message: `the board file ${read.reason}` }]));
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(read.text);
    } catch {
      // A fixed message: the parser's own message quotes part of the file.
      boards.push(invalid([{ path: "", message: "the board file is not valid JSON" }]));
      continue;
    }
    const parsed = parseBoard(json);
    if (!parsed.ok) {
      const title = (json as { title?: unknown })?.title;
      boards.push(invalid(parsed.error, typeof title === "string" ? title.slice(0, 300) : slug));
      continue;
    }
    const board = parsed.value;
    parsedBoards.set(slug, board);
    for (const nodeId of unlinkedFlowElements(board)) unlinked.push(`${slug} (${nodeId})`);
    const checked = await checkSources(board, realRoot, { reader });
    const kind = boardKindOf(board);
    kinds.set(slug, kind);
    const layoutFrom: LayoutOrigin[] = [];
    for (const node of board.nodes) {
      if (node.layoutFrom !== undefined && !layoutFrom.includes(node.layoutFrom)) {
        layoutFrom.push(node.layoutFrom);
      }
    }
    const claims = boardClaims(board);
    const specOnly = claims.filter((c) => c.grounding === "spec").map((c) => c.path);
    const manual = claims.filter((c) => c.manual).map((c) => `${c.path} (${c.id})`);
    const overlay = await readOverlayFile(realDir, slug);
    const overlayWarnings =
      overlay.status === "invalid"
        ? [overlay.warning]
        : overlay.status === "ok"
          ? [...overlayOrphans(board, overlay.overlay), ...lintOverlayText(overlay.overlay)]
          : [];
    boards.push({
      slug,
      title: board.title,
      kind,
      status: checked.issues.length > 0 ? "stale" : "ok",
      issues: checked.issues,
      staleSourceIds: staleSourceIds(checked.issues, board.sources),
      warnings: [...lintBoardText(board), ...overlayWarnings],
      uncheckedSources: board.sources.filter((s) => !isCheckable(s)).length,
      layoutFrom,
      tags: board.tags ?? [],
      grounding: countGrounding(claims),
      specOnly: specOnly.slice(0, MAX_SPEC_ONLY_PATHS),
      specOnlyTruncated: specOnly.length > MAX_SPEC_ONLY_PATHS,
      ...(manual.length > 0 ? { manual } : {}),
    });
    if (options.require !== undefined) {
      const below = BELOW[options.require];
      const weak = claims.filter((c) => below.has(c.grounding)).map((c) => c.path);
      if (weak.length > 0) {
        const shown = weak.slice(0, MAX_REQUIRE_PATHS).join(", ");
        const more =
          weak.length > MAX_REQUIRE_PATHS ? `, and ${weak.length - MAX_REQUIRE_PATHS} more` : "";
        problems.push({
          path: `${slug}${BOARD_FILE_SUFFIX}`,
          message:
            options.require === "code"
              ? `${weak.length} claim(s) are not backed by code (spec only or unresolved): ${shown}${more}`
              : `${weak.length} claim(s) cite no specification or code (unresolved): ${shown}${more}`,
        });
      }
    }

    const { defined, used } = refsOf(board);
    for (const place of defined) {
      refEntry(place.ref).definedIn.push({
        slug,
        nodeId: place.nodeId,
        kind: place.kind as NodeKind,
      });
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

  const sorted = [...refs.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  problems.push(...refProblems(sorted, (slug) => kinds.get(slug)));

  if (options.baselineDir !== undefined) {
    problems.push(...(await compareBaseline(options.baselineDir, parsedBoards, boards, budget)));
  }

  // Missing flows are hints, never problems: the check still passes.
  const warnings: string[] = [];
  const missing = missingFlowRefs(sorted, (slug) => kinds.get(slug));
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} element(s) that call an API or change state have no flow yet: ${firstFew(listed(missing.slice(0, MAX_MISSING_FLOW_REFS)), missing.length)}; draw one with the board skill, e.g. /groundboard:board`,
    );
  }
  if (unlinked.length > 0) {
    warnings.push(
      `${unlinked.length} element(s) call an API or change state but have no ref, so no flow can point at them: ${firstFew(unlinked.slice(0, MAX_MISSING_FLOW_REFS).join(", "), unlinked.length)}; give each a ref such as web:<screen>/<element>`,
    );
  }

  // An overlay whose board is gone lays out nothing; say so, without failing the check.
  const slugSet = new Set(slugs);
  warnings.push(
    ...(await listOverlaySlugs(realDir))
      .filter((slug) => !slugSet.has(slug))
      .map((slug) => `${slug}${OVERLAY_FILE_SUFFIX} has no ${slug}${BOARD_FILE_SUFFIX} beside it`),
  );

  return { boards, refs: sorted, problems, ...(warnings.length > 0 ? { warnings } : {}) };
}

/**
 * Compares the atlas with a copy taken before an update: every node id, edge id and ref of a
 * baseline board that the current board of the same slug lacks is a problem, and so is a
 * baseline board with no current board. A current board that is invalid is already reported
 * and is not compared.
 */
async function compareBaseline(
  baselineDir: string,
  current: ReadonlyMap<string, Board>,
  entries: readonly AtlasBoardEntry[],
  budget: { remaining: number },
): Promise<Issue[]> {
  const realBaseline = await realpath(baselineDir);
  const problems: Issue[] = [];
  const status = new Map(entries.map((e) => [e.slug, e.status]));
  const names = (await listBoardFiles(realBaseline)).filter((name) =>
    BOARD_SLUG.test(name.slice(0, -BOARD_FILE_SUFFIX.length)),
  );
  for (const name of names.slice(0, MAX_ATLAS_BOARDS)) {
    const slug = name.slice(0, -BOARD_FILE_SUFFIX.length);
    const at = `baseline/${name}`;
    const read = await readConfined(realBaseline, name, budget, MAX_BOARD_FILE_BYTES, {
      noSymlink: true,
    });
    let parsed: ReturnType<typeof parseBoard> | undefined;
    if (read.ok) {
      try {
        parsed = parseBoard(JSON.parse(read.text));
      } catch {
        parsed = undefined;
      }
    }
    if (parsed === undefined || !parsed.ok) {
      problems.push({ path: at, message: "the baseline board cannot be read as a valid board" });
      continue;
    }
    if (!status.has(slug)) {
      problems.push({
        path: at,
        message: `board \`${slug}\` is in the baseline but no longer in the atlas; restore it, or rename on purpose and update the boards that point at it`,
      });
      continue;
    }
    const board = current.get(slug);
    if (board === undefined) continue; // invalid now, reported with the board
    const before = identities(parsed.value);
    const after = identities(board);
    const lost = (what: "nodes" | "edges" | "refs") =>
      [...before[what]].filter((value) => !after[what].has(value));
    const lostNodes = lost("nodes");
    const lostEdges = lost("edges");
    const lostRefs = lost("refs");
    const file = `${slug}${BOARD_FILE_SUFFIX}`;
    if (lostNodes.length > 0) {
      problems.push({
        path: file,
        message: `node id(s) in the baseline are gone: ${listed(lostNodes)}`,
      });
    }
    if (lostEdges.length > 0) {
      problems.push({
        path: file,
        message: `edge id(s) in the baseline are gone: ${listed(lostEdges)}`,
      });
    }
    if (lostRefs.length > 0) {
      problems.push({
        path: file,
        message: `ref(s) in the baseline are gone: ${listed(lostRefs)}`,
      });
    }
  }
  return problems;
}

/** Whether the atlas has anything to fix: a stale or invalid board, or a problem. */
export function atlasHasProblems(index: AtlasIndex): boolean {
  return index.problems.length > 0 || index.boards.some((b) => b.status !== "ok");
}
