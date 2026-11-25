import { type Overlay, parseBoard, parseOverlay } from "@groundboard/schema";
import { strFromU8, strToU8, type UnzipFileInfo, unzipSync, zipSync } from "fflate";
import { type Scene, toScene } from "./input.ts";
import { SLUG_PATTERN } from "./route.ts";

/**
 * Reading and writing zips of boards. The functions here are pure and synchronous: the viewer
 * runs them in `zip-worker.ts`, so a large archive never blocks the tab.
 *
 * A zip holds `.groundboard/<slug>.board.json`, its layout overlay `.groundboard/<slug>.overlay.json`
 * when it has one and, optionally, `.groundboard/<slug>.excalidraw`
 * and `images/<slug>.png`; boards that could not be rendered are listed in `errors.txt`.
 * Files at the root of the zip are read too, so a zip of a bare `.groundboard/` folder works.
 */

/** Most boards one zip may hold, as many as an atlas reads. */
export const MAX_ATLAS_BOARDS = 200;
/** Largest board or scene file in a zip, as large as the atlas reads. */
export const MAX_BOARD_FILE_BYTES = 8 * 1024 * 1024;
/** Most bytes one zip may unpack to, all files counted. */
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
/** Highest compression ratio a file may claim; a larger one is taken for a zip bomb. */
export const MAX_COMPRESSION_RATIO = 100;
/**
 * Files smaller than this skip the ratio check: they cannot unpack to much whatever they claim,
 * and a short run of repeated JSON compresses past 100:1 honestly.
 */
const RATIO_CHECK_FROM_BYTES = 64 * 1024;
/** Most entries the central directory may list before the zip is refused unread. */
const MAX_ENTRIES = 5000;

export const BOARD_SUFFIX = ".board.json";
export const OVERLAY_SUFFIX = ".overlay.json";
export const SCENE_SUFFIX = ".excalidraw";
export const ERRORS_FILE = "errors.txt";
const BOARD_DIR = ".groundboard/";
const IMAGE_DIR = "images/";

/** Why a whole zip was refused; nothing of it is loaded. */
export type ZipProblem =
  | { code: "not-zip" }
  | { code: "unsafe-name"; name: string }
  | { code: "too-many-entries"; limit: number }
  | { code: "too-many-boards"; limit: number }
  | { code: "file-too-large"; name: string; limit: number }
  | { code: "too-large"; limit: number }
  | { code: "ratio"; name: string; limit: number };

/** Why one file of a zip was not loaded while the others were. */
export type ZipNoteReason =
  | "not-board"
  | "image"
  | "duplicate"
  | "scene-shadowed"
  | "overlay-orphan"
  | "not-json"
  | "invalid-board"
  | "invalid-scene"
  | "invalid-overlay";

export interface ZipNote {
  name: string;
  reason: ZipNoteReason;
  /** The first validation issue, for an invalid board. */
  detail?: string;
}

export interface ZipBoard {
  slug: string;
  board: Record<string, unknown>;
  /** The file as it was in the zip. */
  text: string;
}

export interface ZipScene {
  slug: string;
  scene: Scene;
}

export interface ZipOverlay {
  slug: string;
  overlay: Overlay;
}

export type ZipRead =
  | {
      ok: true;
      boards: ZipBoard[];
      scenes: ZipScene[];
      /** Layout overlays of boards in the same zip. */
      overlays: ZipOverlay[];
      /** Files left out on purpose: images, other files, a scene beside a board of its name. */
      skipped: ZipNote[];
      /** Boards and scenes that failed to parse or validate. */
      rejected: ZipNote[];
    }
  | { ok: false; problem: ZipProblem };

class ZipRefused extends Error {
  readonly problem: ZipProblem;
  constructor(problem: ZipProblem) {
    super(problem.code);
    this.problem = problem;
  }
}

/**
 * Whether an entry name could point outside a folder it is unpacked into: absolute, a drive
 * letter, a `..` segment, a backslash or NUL. Such a zip is refused whole: nobody's own export
 * contains one.
 */
export function isUnsafeName(name: string): boolean {
  return (
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").includes("..")
  );
}

type EntryKind = { kind: "board" | "scene" | "overlay"; slug: string } | { kind: "image" } | null;

/** What an entry is by its name: a board or scene at the root or in `.groundboard/`, or neither. */
function classify(name: string): EntryKind {
  if (name.startsWith(IMAGE_DIR)) return { kind: "image" };
  const rest = name.startsWith(BOARD_DIR) ? name.slice(BOARD_DIR.length) : name;
  if (rest.includes("/")) return null;
  for (const [suffix, kind] of [
    [BOARD_SUFFIX, "board"],
    [OVERLAY_SUFFIX, "overlay"],
    [SCENE_SUFFIX, "scene"],
  ] as const) {
    if (rest.endsWith(suffix)) {
      const slug = rest.slice(0, -suffix.length);
      return SLUG_PATTERN.test(slug) ? { kind, slug } : null;
    }
  }
  return null;
}

/** Checks the sizes the archive declares for one entry, before anything is unpacked. */
function checkSizes(file: UnzipFileInfo, total: { bytes: number }): void {
  if (file.originalSize > MAX_BOARD_FILE_BYTES) {
    throw new ZipRefused({ code: "file-too-large", name: file.name, limit: MAX_BOARD_FILE_BYTES });
  }
  total.bytes += file.originalSize;
  if (total.bytes > MAX_ZIP_BYTES)
    throw new ZipRefused({ code: "too-large", limit: MAX_ZIP_BYTES });
  if (
    file.originalSize >= RATIO_CHECK_FROM_BYTES &&
    file.originalSize > file.size * MAX_COMPRESSION_RATIO
  ) {
    throw new ZipRefused({ code: "ratio", name: file.name, limit: MAX_COMPRESSION_RATIO });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Element types a scene from a zip may not carry: they load files or pages from elsewhere. */
const DROPPED_ELEMENTS = new Set(["image", "embeddable", "iframe"]);

/** A scene from a zip: checked as a pasted one is, without its files and embedded content. */
export function sceneFromZip(value: unknown): Scene | null {
  if (!isRecord(value) || value.type !== "excalidraw") return null;
  const scene = toScene(value);
  if (!scene) return null;
  return {
    elements: scene.elements.filter(
      (el) => !(isRecord(el) && DROPPED_ELEMENTS.has(String(el.type))),
    ),
    appState: scene.appState,
    files: {},
  };
}

/**
 * Unpacks the entries `keep` accepts. Names and the sizes the archive declares are checked
 * before anything is unpacked, then the sizes actually unpacked: an unsafe name or a size over
 * a limit refuses the whole zip.
 */
function unzipChecked(
  bytes: Uint8Array,
  keep: (name: string) => boolean,
): { ok: true; files: Record<string, Uint8Array> } | { ok: false; problem: ZipProblem } {
  const total = { bytes: 0 };
  let entries = 0;
  let boardFiles = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > MAX_ENTRIES) {
          throw new ZipRefused({ code: "too-many-entries", limit: MAX_ENTRIES });
        }
        if (isUnsafeName(file.name)) throw new ZipRefused({ code: "unsafe-name", name: file.name });
        if (file.name.endsWith("/") || !keep(file.name)) return false;
        if (classify(file.name)?.kind === "board") {
          boardFiles += 1;
          if (boardFiles > MAX_ATLAS_BOARDS) {
            throw new ZipRefused({ code: "too-many-boards", limit: MAX_ATLAS_BOARDS });
          }
        }
        checkSizes(file, total);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ZipRefused) return { ok: false, problem: error.problem };
    return { ok: false, problem: { code: "not-zip" } };
  }
  let unpacked = 0;
  for (const [name, data] of Object.entries(files)) {
    if (data.length > MAX_BOARD_FILE_BYTES) {
      return { ok: false, problem: { code: "file-too-large", name, limit: MAX_BOARD_FILE_BYTES } };
    }
    unpacked += data.length;
    if (unpacked > MAX_ZIP_BYTES) {
      return { ok: false, problem: { code: "too-large", limit: MAX_ZIP_BYTES } };
    }
  }
  return { ok: true, files };
}

/** Every file of a zip, under the same checks as `readBoardZip`, to add files and pack again. */
export function unpackZip(
  bytes: Uint8Array,
): { ok: true; files: ZipFile[] } | { ok: false; problem: ZipProblem } {
  const unpacked = unzipChecked(bytes, () => true);
  if (!unpacked.ok) return unpacked;
  return {
    ok: true,
    files: Object.entries(unpacked.files).map(([path, data]) => ({ path, data })),
  };
}

/**
 * Reads a zip of boards. Every board is validated on its own, so one bad board does not keep
 * the others out. Only boards and scenes are unpacked; other files are listed as skipped.
 */
export function readBoardZip(bytes: Uint8Array): ZipRead {
  const skipped: ZipNote[] = [];
  const unpacked = unzipChecked(bytes, (name) => {
    const kind = classify(name);
    if (kind === null) {
      if (name !== ERRORS_FILE) skipped.push({ name, reason: "not-board" });
      return false;
    }
    if (kind.kind === "image") {
      skipped.push({ name, reason: "image" });
      return false;
    }
    return true;
  });
  if (!unpacked.ok) return unpacked;
  const { files } = unpacked;

  const boards: ZipBoard[] = [];
  const scenes: ZipScene[] = [];
  const rejected: ZipNote[] = [];
  const boardSlugs = new Set<string>();
  const sceneFiles: Array<{ name: string; slug: string; data: Uint8Array }> = [];
  const overlayFiles: Array<{ name: string; slug: string; data: Uint8Array }> = [];
  // Sorted, so `.groundboard/x` and a root `x` resolve the same way whatever the zip's order.
  for (const name of Object.keys(files).sort()) {
    const kind = classify(name);
    const data = files[name];
    if (!kind || kind.kind === "image" || !data) continue;
    if (kind.kind === "scene") {
      sceneFiles.push({ name, slug: kind.slug, data });
      continue;
    }
    if (kind.kind === "overlay") {
      overlayFiles.push({ name, slug: kind.slug, data });
      continue;
    }
    if (boardSlugs.has(kind.slug)) {
      skipped.push({ name, reason: "duplicate" });
      continue;
    }
    const text = strFromU8(data);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      rejected.push({ name, reason: "not-json" });
      continue;
    }
    const parsed = parseBoard(json);
    if (!parsed.ok || !isRecord(json)) {
      const issue = parsed.ok ? undefined : parsed.error[0];
      rejected.push({
        name,
        reason: "invalid-board",
        ...(issue
          ? { detail: issue.path ? `${issue.path}: ${issue.message}` : issue.message }
          : {}),
      });
      continue;
    }
    boardSlugs.add(kind.slug);
    boards.push({ slug: kind.slug, board: json, text });
  }

  const sceneSlugs = new Set<string>();
  for (const { name, slug, data } of sceneFiles) {
    // The board is the source; its rendered scene beside it is a copy.
    if (boardSlugs.has(slug)) {
      skipped.push({ name, reason: "scene-shadowed" });
      continue;
    }
    if (sceneSlugs.has(slug)) {
      skipped.push({ name, reason: "duplicate" });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(strFromU8(data));
    } catch {
      rejected.push({ name, reason: "not-json" });
      continue;
    }
    const scene = sceneFromZip(json);
    if (!scene) {
      rejected.push({ name, reason: "invalid-scene" });
      continue;
    }
    sceneSlugs.add(slug);
    scenes.push({ slug, scene });
  }

  const overlays: ZipOverlay[] = [];
  const overlaySlugs = new Set<string>();
  for (const { name, slug, data } of overlayFiles) {
    // An overlay lays out its own board; without the board here it has nothing to move.
    if (!boardSlugs.has(slug)) {
      skipped.push({ name, reason: "overlay-orphan" });
      continue;
    }
    if (overlaySlugs.has(slug)) {
      skipped.push({ name, reason: "duplicate" });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(strFromU8(data));
    } catch {
      rejected.push({ name, reason: "not-json" });
      continue;
    }
    const parsed = parseOverlay(json);
    if (!parsed.ok) {
      const issue = parsed.error[0];
      rejected.push({
        name,
        reason: "invalid-overlay",
        ...(issue
          ? { detail: issue.path ? `${issue.path}: ${issue.message}` : issue.message }
          : {}),
      });
      continue;
    }
    overlaySlugs.add(slug);
    overlays.push({ slug, overlay: parsed.value });
  }

  return { ok: true, boards, scenes, overlays, skipped, rejected };
}

/** One file to put in a zip: a path inside it and its content. */
export interface ZipFile {
  path: string;
  data: string | Uint8Array;
}

/** Packs files into a zip; text is stored as UTF-8. */
export function writeBoardZip(files: readonly ZipFile[]): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const file of files) {
    tree[file.path] = typeof file.data === "string" ? strToU8(file.data) : file.data;
  }
  return zipSync(tree, { level: 6 });
}

/** Where a board, its scene and its image go in a zip. */
export const zipPaths = {
  board: (slug: string) => `${BOARD_DIR}${slug}${BOARD_SUFFIX}`,
  overlay: (slug: string) => `${BOARD_DIR}${slug}${OVERLAY_SUFFIX}`,
  scene: (slug: string) => `${BOARD_DIR}${slug}${SCENE_SUFFIX}`,
  image: (slug: string) => `${IMAGE_DIR}${slug}.png`,
};
