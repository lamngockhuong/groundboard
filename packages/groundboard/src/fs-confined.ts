import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Largest source file the checker reads. */
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
/** Total bytes one source check may read across all files. */
export const MAX_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;

export type ConfinedRead = { ok: true; text: string } | { ok: false; reason: string };
export type ConfinedBytes = { ok: true; bytes: Buffer } | { ok: false; reason: string };
export type LinesRead = { ok: true; lines: string[] } | { ok: false; reason: string };

export function isInside(child: string, parent: string): boolean {
  return (
    child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
  );
}

const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`;

/**
 * Resolves a relative path under `root` (a real path) and reads it, refusing anything that
 * escapes the root (by `..` or a symlink), is not a regular file, or is larger than `maxBytes`
 * or the bytes left in `budget`. Reasons never contain file content. With `noSymlink`, the
 * file itself must not be a symlink, even to a file inside the root.
 */
export async function readConfined(
  root: string,
  relative: string,
  budget: { remaining: number },
  maxBytes = MAX_SOURCE_FILE_BYTES,
  options: { noSymlink?: boolean } = {},
): Promise<ConfinedRead> {
  const read = await readConfinedBytes(root, relative, budget, maxBytes, options);
  return read.ok ? { ok: true, text: read.bytes.toString("utf8") } : read;
}

/** `readConfined` for binary files: the same checks, the bytes as read. */
export async function readConfinedBytes(
  root: string,
  relative: string,
  budget: { remaining: number },
  maxBytes = MAX_SOURCE_FILE_BYTES,
  options: { noSymlink?: boolean } = {},
): Promise<ConfinedBytes> {
  const candidate = path.resolve(root, relative);
  if (!isInside(candidate, root)) return { ok: false, reason: "resolves outside the root" };
  if (options.noSymlink) {
    try {
      if ((await lstat(candidate)).isSymbolicLink()) return { ok: false, reason: "is a symlink" };
    } catch {
      return { ok: false, reason: "file not found" };
    }
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return { ok: false, reason: "file not found" };
  }
  if (!isInside(real, root))
    return { ok: false, reason: "resolves outside the root through a symlink" };

  // O_NONBLOCK keeps a FIFO from blocking the open; fstat then rejects anything not regular.
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch {
    return { ok: false, reason: "cannot be opened" };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, reason: "is not a regular file" };
    if (info.size > maxBytes) return { ok: false, reason: `is larger than ${megabytes(maxBytes)}` };
    if (info.size > budget.remaining) {
      return { ok: false, reason: "exceeds the total size this check may read" };
    }
    // Read at most the cap: some files (procfs, FUSE) report size 0 and read on past it. The
    // buffer starts at the reported size and grows only for such files.
    const limit = Math.min(maxBytes, budget.remaining);
    let buffer = Buffer.alloc(Math.min(limit, info.size) + 1);
    let length = 0;
    for (;;) {
      if (length === buffer.length) {
        const grown = Buffer.alloc(Math.min(limit + 1, Math.max(buffer.length * 2, 64 * 1024)));
        buffer.copy(grown, 0, 0, length);
        buffer = grown;
      }
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > limit) {
        return {
          ok: false,
          reason:
            limit === maxBytes
              ? `is larger than ${megabytes(maxBytes)}`
              : "exceeds the total size this check may read",
        };
      }
    }
    budget.remaining -= length;
    return { ok: true, bytes: buffer.subarray(0, length) };
  } finally {
    await handle.close();
  }
}

/**
 * Whether `relative` names a regular file under `root` (a real path), without reading a byte:
 * the path and every symlink on it must resolve inside the root, and the target must be a
 * regular file. Reasons never contain file content.
 */
export async function existsConfined(
  root: string,
  relative: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const candidate = path.resolve(root, relative);
  if (!isInside(candidate, root)) return { ok: false, reason: "resolves outside the root" };
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return { ok: false, reason: "does not exist under the root" };
  }
  if (!isInside(real, root))
    return { ok: false, reason: "resolves outside the root through a symlink" };
  try {
    if (!(await lstat(real)).isFile()) return { ok: false, reason: "is not a regular file" };
  } catch {
    return { ok: false, reason: "does not exist under the root" };
  }
  return { ok: true };
}

export function toLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop(); // trailing newline ends the last line
  return lines;
}

/**
 * Reads source files under one root for one or many checks: each file is read once, and every
 * read, across all boards of an atlas, draws on one byte budget.
 */
export interface SourceReader {
  /** Real path of the root. */
  root: string;
  budget: { remaining: number };
  read(relative: string): Promise<LinesRead>;
  /** Whether a regular file exists under the root; reads no content and spends no budget. */
  exists(relative: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export function createSourceReader(
  realRoot: string,
  budget: { remaining: number } = { remaining: MAX_TOTAL_SOURCE_BYTES },
): SourceReader {
  const files = new Map<string, LinesRead>();
  return {
    root: realRoot,
    budget,
    async read(relative) {
      // `a.ts`, `./a.ts` and `src//a.ts` are one file: read and charge it once.
      const key = path.resolve(realRoot, relative);
      const cached = files.get(key);
      if (cached) return cached;
      const result = await readConfined(realRoot, relative, budget);
      const lines: LinesRead = result.ok ? { ok: true, lines: toLines(result.text) } : result;
      files.set(key, lines);
      return lines;
    },
    exists(relative) {
      return existsConfined(realRoot, relative);
    },
  };
}

export const BOARD_FILE_SUFFIX = ".board.json";

/**
 * Names of the regular files directly in `dir` that end in `.board.json`, sorted. Symlinks,
 * FIFOs, sockets and directories are skipped; nothing below the first level is listed.
 */
export async function listBoardFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(BOARD_FILE_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}
