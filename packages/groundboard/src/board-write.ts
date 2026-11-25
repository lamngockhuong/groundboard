import { createHash, randomBytes } from "node:crypto";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Issue, LIMITS } from "@groundboard/schema";
import { BOARD_SLUG, MAX_BOARD_FILE_BYTES } from "./atlas.ts";
import { BOARD_FILE_SUFFIX, readConfined } from "./fs-confined.ts";
import { OVERLAY_FILE_SUFFIX } from "./overlay-file.ts";

/** The files of an atlas board a person may write from the viewer. */
export type AtlasFileKind = "board" | "overlay";

const SUFFIX: Record<AtlasFileKind, string> = {
  board: BOARD_FILE_SUFFIX,
  overlay: OVERLAY_FILE_SUFFIX,
};
const MAX_BYTES: Record<AtlasFileKind, number> = {
  board: MAX_BOARD_FILE_BYTES,
  overlay: LIMITS.overlayBytes,
};

/** The ETag of a board or overlay file: the SHA-256 of its bytes, as the viewer computes it. */
export function etagOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type Produced =
  | { ok: true; text: string }
  | { ok: false; status: 409 | 422; error: string; issues?: Issue[] };

export type AtlasWrite =
  | { ok: true; etag: string; text: string }
  | {
      ok: false;
      status: 400 | 404 | 409 | 413 | 422;
      error: string;
      issues?: Issue[];
      /** On a 409 for a changed file: the ETag it has now, or null when it is gone. */
      etag?: string | null;
    };

/** One write at a time per board: its board file and its overlay share the lock. */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  locks.set(key, settled);
  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

/**
 * Writes `<slug>.board.json` or `<slug>.overlay.json` directly in the atlas directory `dir` (a
 * real path the caller confined). The caller validates what it can before calling; under a
 * per-board lock this then reads the file as it is now, compares its SHA-256 with
 * `expectedEtag` (`null`: the file must not exist yet; `undefined`: no comparison), asks
 * `produce` for the new text, and writes it to a temporary file renamed over the old one, so a
 * reader never sees half a file. An overlay is written only beside an existing board.
 */
export async function writeAtlasFile(
  dir: string,
  slug: string,
  kind: AtlasFileKind,
  produce: (current: string | null) => Produced,
  expectedEtag?: string | null,
): Promise<AtlasWrite> {
  if (!BOARD_SLUG.test(slug)) return { ok: false, status: 400, error: "invalid board name" };
  const name = `${slug}${SUFFIX[kind]}`;
  const target = path.join(dir, name);
  return withLock(path.join(dir, slug), async () => {
    if (kind === "overlay") {
      const board = await readConfined(
        dir,
        `${slug}${BOARD_FILE_SUFFIX}`,
        { remaining: MAX_BOARD_FILE_BYTES },
        MAX_BOARD_FILE_BYTES,
        { noSymlink: true },
      );
      if (!board.ok) return { ok: false, status: 404, error: "no such board" };
    }
    const read = await readConfined(dir, name, { remaining: MAX_BYTES[kind] }, MAX_BYTES[kind], {
      noSymlink: true,
    });
    // A board is only ever replaced; an overlay may be written for the first time.
    if (!read.ok && (kind === "board" || read.reason !== "file not found")) {
      return {
        ok: false,
        status: kind === "board" ? 404 : 409,
        error: `the ${kind} file ${read.reason}`,
      };
    }
    const current = read.ok ? read.text : null;
    const currentEtag = current === null ? null : etagOf(current);
    if (expectedEtag !== undefined && expectedEtag !== currentEtag) {
      return {
        ok: false,
        status: 409,
        error: `the ${kind} file changed since it was read; load it again`,
        etag: currentEtag,
      };
    }
    const produced = produce(current);
    if (!produced.ok) return produced;
    if (Buffer.byteLength(produced.text) > MAX_BYTES[kind]) {
      return { ok: false, status: 413, error: `the ${kind} file would be larger than allowed` };
    }
    // The read refused a symlink; check again right before replacing the file.
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        return { ok: false, status: 409, error: `the ${kind} file is a symlink` };
      }
    } catch {
      // Not there yet: a first overlay.
    }
    const temporary = path.join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, produced.text, { flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { ok: true, etag: etagOf(produced.text), text: produced.text };
  });
}
