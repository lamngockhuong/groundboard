import * as z from "zod";
import { type Board, type BoardNode, FIGMA_NODE_ID, type FigmaSource } from "./board.ts";
import { owningScreen, stateRoots } from "./states.ts";

/**
 * The Figma frame a screen is drawn from: the first figma source it cites. A state that cites
 * none has no frame of its own, so `undefined` (callers that want the root's ask for it).
 */
export function screenFigmaSource(
  screen: Pick<BoardNode, "sourceIds">,
  sources: ReadonlyMap<string, Board["sources"][number]>,
): FigmaSource | undefined {
  for (const sourceId of screen.sourceIds) {
    const source = sources.get(sourceId);
    if (source?.kind === "figma") return source;
  }
  return undefined;
}

/**
 * Warnings for an element whose figma source lies in another Figma file than its screen's
 * frame: an element cites the layer it was built from, which is inside that frame. Whether the
 * layer really lies inside the frame cannot be checked without Figma, so it is not.
 */
export function lintFigmaSources(board: Board): string[] {
  const warnings: string[] = [];
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const byId = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const roots = stateRoots(board);
  const frameOf = (screen: BoardNode): FigmaSource | undefined => {
    const own = screenFigmaSource(screen, sources);
    if (own !== undefined) return own;
    const root = byId.get(roots.get(screen.id) ?? "");
    return root === undefined ? undefined : screenFigmaSource(root, sources);
  };
  board.nodes.forEach((node, i) => {
    if (node.kind !== "element") return;
    const screen = owningScreen(node.id, byId);
    const frame = screen === undefined ? undefined : frameOf(screen);
    if (frame === undefined) return;
    node.sourceIds.forEach((sourceId, j) => {
      const source = sources.get(sourceId);
      if (source?.kind !== "figma" || source.fileKey === frame.fileKey) return;
      warnings.push(
        `nodes[${i}].sourceIds[${j}] cites figma source \`${source.id}\` in file ${source.fileKey}, but screen \`${screen?.id}\` is drawn from file ${frame.fileKey}; an element cites a layer of its screen's frame`,
      );
    });
  });
  return warnings;
}

// --- Reference image cache ------------------------------------------------------------------

/** Where Figma frame images are cached, relative to the atlas directory. Never committed. */
export const FIGMA_CACHE_DIR = ".cache/figma";
/** Written into the cache directory when it is first created, so nothing in it is committed. */
export const CACHE_GITIGNORE = "*\n";
/** Widest or tallest image a cache entry may describe, so layout never reserves a runaway width. */
export const MAX_IMAGE_SIDE = 16384;
/** Most layer boxes one cache entry may hold. */
export const MAX_CACHED_NODES = 5000;

const timestamp = z.iso.datetime({ offset: true });
/** A SHA-256 digest in lowercase hexadecimal. */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 digest in lowercase hexadecimal");

/** `[x, y, width, height]` of a layer, relative to the frame's top-left corner. */
const BoxSchema = z.tuple([z.number(), z.number(), z.number().min(0), z.number().min(0)]);

/**
 * One cached Figma frame: `<name>.json` beside `<name>.png`, where `<name>` is
 * `figmaCacheName(fileKey, nodeId)`. Written by the `screen` skill through the Figma MCP tools
 * (and later by `groundboard figma pull`); read by the renderer, which never calls Figma.
 */
export const FigmaCacheEntrySchema = z.object({
  fileKey: z.string().regex(/^[A-Za-z0-9]{10,64}$/),
  nodeId: z.string().regex(FIGMA_NODE_ID),
  /** When the image and the boxes were taken. */
  fetchedAt: timestamp,
  /** The Figma file's `lastModified` at that time, when the writer knew it. */
  lastModified: timestamp.optional(),
  /**
   * SHA-256 of the canonical outline of the frame's layers (`groundboard figma entry`), and of
   * the image's decoded RGBA pixels, at fetch time. Entries written before them have neither.
   */
  contentHash: sha256.optional(),
  pixelHash: sha256.optional(),
  /** When the design was last looked at again, and what it was then. */
  checkedAt: timestamp.optional(),
  checkedLastModified: timestamp.optional(),
  checkedContentHash: sha256.optional(),
  checkedPixelHash: sha256.optional(),
  image: z.object({
    width: z.int().positive().max(MAX_IMAGE_SIDE),
    height: z.int().positive().max(MAX_IMAGE_SIDE),
    /** The frame's top-left corner inside the image: effects and overflow can push it in. */
    originX: z.number().min(0),
    originY: z.number().min(0),
  }),
  /** Boxes of the layers the board's elements cite, by Figma node id. */
  nodes: z
    .record(z.string().regex(FIGMA_NODE_ID), BoxSchema)
    .refine((nodes) => Object.keys(nodes).length <= MAX_CACHED_NODES, {
      message: `at most ${MAX_CACHED_NODES} node boxes`,
    })
    .default({}),
});

export type FigmaCacheEntry = z.output<typeof FigmaCacheEntrySchema>;

/** The file name, without extension, of a frame's cache entry: `:` written `-`, `;` written `_`. */
export function figmaCacheName(source: Pick<FigmaSource, "fileKey" | "nodeId">): string {
  return `${source.fileKey}-${source.nodeId.replaceAll(":", "-").replaceAll(";", "_")}`;
}

/**
 * Whether a later look at the Figma design found it changed after the image was taken: a
 * different outline or pixel hash, or a newer `lastModified`. A value recorded on only one side
 * proves nothing, so an entry without hashes never counts as changed.
 */
export function designChanged(entry: FigmaCacheEntry): boolean {
  const differs = (recorded: string | undefined, checked: string | undefined) =>
    recorded !== undefined && checked !== undefined && recorded !== checked;
  if (differs(entry.contentHash, entry.checkedContentHash)) return true;
  if (differs(entry.pixelHash, entry.checkedPixelHash)) return true;
  if (entry.lastModified === undefined || entry.checkedLastModified === undefined) return false;
  return Date.parse(entry.checkedLastModified) > Date.parse(entry.lastModified);
}
