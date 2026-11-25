import { realpath } from "node:fs/promises";
import type { ReferenceSize } from "@groundboard/layout";
import { type ReferenceImage, referenceCaption } from "@groundboard/render-excalidraw";
import {
  type Board,
  designChanged,
  FigmaCacheEntrySchema,
  figmaCacheName,
  screenFigmaSource,
} from "@groundboard/schema";
import { isInside, readConfined, readConfinedBytes } from "./fs-confined.ts";

/** Largest cached image read for one frame. */
export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
/** Most image bytes read for one board, all frames together. */
export const MAX_REFERENCE_BOARD_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;

export interface ReferenceOptions {
  /** The cache directory, normally `<atlas>/.cache/figma`. Nothing outside it is read. */
  dir: string;
  /** A real path the cache directory must resolve inside, symlinks followed. */
  within?: string;
  maxImageBytes?: number;
  maxBoardBytes?: number;
}

/** How many of a board's frames cite a Figma frame, and how many of those have a cached image. */
export interface ReferenceCount {
  frames: number;
  cached: number;
}

export interface LoadedReferences extends ReferenceCount {
  images: Map<string, ReferenceImage>;
  sizes: Record<string, ReferenceSize>;
  warnings: string[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Reads the cached image of every frame of a board drawn with a wireframe that cites a Figma
 * frame. A frame with nothing cached is skipped quietly; a cache entry that cannot be used is
 * skipped with a warning. Reads only regular files directly under `options.dir`, never through
 * a symlink, within the size caps.
 */
export async function loadReferences(
  board: Board,
  options: ReferenceOptions,
): Promise<LoadedReferences> {
  const out: LoadedReferences = {
    images: new Map(),
    sizes: {},
    warnings: [],
    frames: 0,
    cached: 0,
  };
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const withElements = new Set(
    board.nodes.flatMap((n) => (n.kind === "element" && n.parentId ? [n.parentId] : [])),
  );
  const frames = board.nodes.flatMap((node) => {
    if (node.kind !== "screen" || !withElements.has(node.id)) return [];
    const figma = screenFigmaSource(node, sources);
    return figma === undefined ? [] : [{ screenId: node.id, figma }];
  });
  out.frames = frames.length;
  if (frames.length === 0) return out;

  let dir: string;
  try {
    dir = await realpath(options.dir);
  } catch {
    return out; // nothing cached yet
  }
  if (options.within !== undefined && !isInside(dir, options.within)) {
    out.warnings.push("reference images not read: the cache directory resolves outside the atlas");
    return out;
  }
  const budget = { remaining: options.maxBoardBytes ?? MAX_REFERENCE_BOARD_BYTES };
  const maxImage = options.maxImageBytes ?? MAX_REFERENCE_IMAGE_BYTES;
  const warn = (screenId: string, name: string, why: string) =>
    out.warnings.push(`reference image for screen \`${screenId}\` (${name}) not used: ${why}`);

  for (const { screenId, figma } of frames) {
    const name = figmaCacheName(figma);
    const entryRead = await readConfined(
      dir,
      `${name}.json`,
      { remaining: MAX_ENTRY_BYTES },
      MAX_ENTRY_BYTES,
      { noSymlink: true },
    );
    if (!entryRead.ok) {
      if (entryRead.reason !== "file not found") warn(screenId, `${name}.json`, entryRead.reason);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(entryRead.text);
    } catch {
      warn(screenId, `${name}.json`, "it is not valid JSON");
      continue;
    }
    const parsed = FigmaCacheEntrySchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      warn(screenId, `${name}.json`, `${issue?.path.join(".") || "entry"}: ${issue?.message}`);
      continue;
    }
    const entry = parsed.data;
    if (entry.fileKey !== figma.fileKey || entry.nodeId !== figma.nodeId) {
      warn(screenId, `${name}.json`, "it describes another Figma node");
      continue;
    }
    const png = await readConfinedBytes(dir, `${name}.png`, budget, maxImage, { noSymlink: true });
    if (!png.ok) {
      warn(screenId, `${name}.png`, png.reason);
      continue;
    }
    const size = pngSize(png.bytes);
    if (size === null) {
      warn(screenId, `${name}.png`, "it is not a PNG");
      continue;
    }
    if (size.width !== entry.image.width || size.height !== entry.image.height) {
      warn(
        screenId,
        `${name}.png`,
        `it is ${size.width}×${size.height} but its entry says ${entry.image.width}×${entry.image.height}`,
      );
      continue;
    }
    const image: ReferenceImage = {
      figma: { fileKey: figma.fileKey, nodeId: figma.nodeId },
      dataUrl: `data:image/png;base64,${png.bytes.toString("base64")}`,
      fetchedAt: entry.fetchedAt,
      designChanged: designChanged(entry),
      originX: entry.image.originX,
      originY: entry.image.originY,
      nodes: entry.nodes,
    };
    out.images.set(screenId, image);
    out.sizes[screenId] = { ...size, caption: referenceCaption(image) };
    out.cached += 1;
  }
  return out;
}
