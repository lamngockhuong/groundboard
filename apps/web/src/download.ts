import { type Failure, fetchAtlasZip, fetchBoardFiles, fetchStaticBoardFile } from "./api.ts";
import type { Draft } from "./drafts.ts";
import type { Scene } from "./input.ts";
import type { LibraryEntry } from "./library.ts";
import type { ZipFile } from "./zip.ts";
import { describeZipProblem, unpackZipFile, writeZip } from "./zip-client.ts";

/** Saves a blob through a temporary object URL and anchor click. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Where the boards of a zip come from: the server's atlas, an exported page, or the library. */
export type ZipSource =
  | { kind: "server"; drafts?: readonly Draft[] }
  | { kind: "static"; slugs: readonly string[]; drafts?: readonly Draft[] }
  | { kind: "library"; entries: readonly LibraryEntry[] };

export interface ZipOptions {
  /** Add each board rendered (`.excalidraw`) and drawn (`images/<slug>.png`). */
  extras: boolean;
  /** Only the boards with a draft in this browser, with their layout. */
  onlyDrafts?: boolean;
  /** Draws a scene as a PNG; needed only with `extras`. */
  toImage?: (scene: Scene) => Promise<Uint8Array>;
  /** Renders a board in the browser; needed only for the library with `extras`. */
  render?: (board: Record<string, unknown>) => Promise<Scene | { error: string }>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export type ZipBuild = { status: "ok"; zip: Uint8Array } | Failure;

const BOARD_DIR = ".groundboard/";
const sceneJson = (scene: Scene) =>
  JSON.stringify({ type: "excalidraw", version: 2, source: "groundboard", ...scene });

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

/**
 * Collects the files of a zip of every board: the board files as written and, with `extras`,
 * each board rendered and drawn. Boards that could not be rendered are named in `errors.txt`.
 * Throws an `AbortError` when `signal` aborts.
 */
export async function buildBoardsZip(source: ZipSource, options: ZipOptions): Promise<ZipBuild> {
  const { extras, signal } = options;
  const progress = options.onProgress ?? (() => {});
  const files: ZipFile[] = [];
  const errors: string[] = [];

  /** Draws each scene file collected so far, one board at a time. */
  const addImages = async () => {
    if (!extras || !options.toImage) return;
    const scenes = files.filter(
      (f) => f.path.startsWith(BOARD_DIR) && f.path.endsWith(".excalidraw"),
    );
    for (const [at, file] of scenes.entries()) {
      throwIfAborted(signal);
      const slug = file.path.slice(BOARD_DIR.length, -".excalidraw".length);
      const text = typeof file.data === "string" ? file.data : new TextDecoder().decode(file.data);
      try {
        const scene = JSON.parse(text) as Scene;
        files.push({ path: `images/${slug}.png`, data: await options.toImage(scene) });
      } catch (error) {
        errors.push(
          `${slug}: not drawn (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      progress(at + 1, scenes.length);
    }
  };

  // The edited boards alone: each draft's board (or the file it was made from) and its layout.
  if (options.onlyDrafts && source.kind !== "library") {
    const drafts = source.drafts ?? [];
    for (const [at, draft] of drafts.entries()) {
      throwIfAborted(signal);
      const fetched =
        draft.board === undefined || draft.overlay === undefined
          ? await fetchBoardFiles(draft.slug)
          : null;
      if (fetched && fetched.status !== "ok" && fetched.status !== "not-found") return fetched;
      const sourceText =
        draft.board !== undefined
          ? `${JSON.stringify(draft.board, null, 2)}\n`
          : fetched?.status === "ok"
            ? fetched.source
            : null;
      if (sourceText === null) {
        errors.push(`${draft.slug}.board.json: not included (the board is gone)`);
      } else {
        files.push({ path: `${BOARD_DIR}${draft.slug}.board.json`, data: sourceText });
        const overlay =
          draft.overlay !== undefined
            ? `${JSON.stringify(draft.overlay, null, 2)}\n`
            : fetched?.status === "ok"
              ? fetched.overlay
              : null;
        if (overlay !== null) {
          files.push({ path: `${BOARD_DIR}${draft.slug}.overlay.json`, data: overlay });
        }
      }
      progress(at + 1, drafts.length);
    }
    if (errors.length > 0) files.push({ path: "errors.txt", data: `${errors.join("\n")}\n` });
    return { status: "ok", zip: await writeZip(files, signal) };
  }

  switch (source.kind) {
    case "server": {
      progress(0, 1);
      const fetched = await fetchAtlasZip(extras, signal);
      if (fetched.status !== "ok") return fetched;
      // Without drawings or drafts, the server's zip is the download as it is.
      if ((!extras || !options.toImage) && !source.drafts?.length) {
        return { status: "ok", zip: new Uint8Array(fetched.bytes) };
      }
      const unpacked = await unpackZipFile(fetched.bytes, signal);
      if (!unpacked.ok) return { status: "error", message: describeZipProblem(unpacked.problem) };
      for (const file of unpacked.files) {
        if (file.path === "errors.txt") {
          errors.push(new TextDecoder().decode(file.data as Uint8Array).trimEnd());
        } else {
          files.push(file);
        }
      }
      await addImages();
      break;
    }
    case "static": {
      for (const [at, slug] of source.slugs.entries()) {
        throwIfAborted(signal);
        const read = await fetchStaticBoardFile(slug);
        if (read.status !== "ok") return read;
        if (read.source !== null) {
          files.push({ path: `${BOARD_DIR}${slug}.board.json`, data: read.source });
          if (read.overlay !== null) {
            files.push({ path: `${BOARD_DIR}${slug}.overlay.json`, data: read.overlay });
          }
        } else {
          // Written by a groundboard that did not embed the board files yet.
          errors.push(`${slug}.board.json: not included (export the atlas again to include it)`);
        }
        if (read.invalid) errors.push(`${slug}.board.json: not rendered (the board is invalid)`);
        else if (extras && read.scene) {
          files.push({ path: `${BOARD_DIR}${slug}.excalidraw`, data: sceneJson(read.scene) });
        }
        progress(at + 1, source.slugs.length);
      }
      await addImages();
      break;
    }
    case "library": {
      for (const [at, entry] of source.entries.entries()) {
        throwIfAborted(signal);
        if (entry.input.type === "scene") {
          // A scene is the user's own file: always kept, so a round trip gives it back.
          files.push({
            path: `${BOARD_DIR}${entry.slug}.excalidraw`,
            data: sceneJson(entry.input.scene),
          });
        } else {
          files.push({
            path: `${BOARD_DIR}${entry.slug}.board.json`,
            data: `${JSON.stringify(entry.input.board, null, 2)}\n`,
          });
          if (entry.overlay !== undefined && entry.overlay !== null) {
            files.push({
              path: `${BOARD_DIR}${entry.slug}.overlay.json`,
              data: `${JSON.stringify(entry.overlay, null, 2)}\n`,
            });
          }
          if (extras && options.render) {
            const rendered = await options.render(entry.input.board);
            if ("error" in rendered) {
              errors.push(`${entry.slug}.board.json: not rendered (${rendered.error})`);
            } else {
              files.push({
                path: `${BOARD_DIR}${entry.slug}.excalidraw`,
                data: sceneJson(rendered),
              });
            }
          }
        }
        progress(at + 1, source.entries.length);
      }
      await addImages();
      break;
    }
  }

  // Drafts are what the person sees: they replace the files they were made from.
  for (const draft of source.kind === "library" ? [] : (source.drafts ?? [])) {
    const put = (path: string, value: unknown) => {
      const data = `${JSON.stringify(value, null, 2)}\n`;
      const at = files.findIndex((f) => f.path === path);
      if (at >= 0) files[at] = { path, data };
      else files.push({ path, data });
    };
    if (draft.board !== undefined) put(`${BOARD_DIR}${draft.slug}.board.json`, draft.board);
    if (draft.overlay !== undefined) put(`${BOARD_DIR}${draft.slug}.overlay.json`, draft.overlay);
  }

  throwIfAborted(signal);
  if (errors.length > 0) files.push({ path: "errors.txt", data: `${errors.join("\n")}\n` });
  return { status: "ok", zip: await writeZip(files, signal) };
}
