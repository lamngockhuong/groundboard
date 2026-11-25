import { t } from "./i18n.ts";
import type { ZipFile, ZipNote, ZipProblem, ZipRead } from "./zip.ts";
import type { ZipRequestBody } from "./zip-worker.ts";

type Unpacked = { ok: true; files: ZipFile[] } | { ok: false; problem: ZipProblem };
type Reply = { read?: ZipRead; unpacked?: Unpacked; zip?: Uint8Array; error?: string };

/**
 * Runs `zip.ts` in a worker: one worker per call, ended when the call settles or is aborted,
 * so cancelling stops the work at once. Falls back to the page's thread where a worker cannot
 * start (tests).
 */
function inWorker<T>(
  request: ZipRequestBody,
  transfer: Transferable[],
  pick: (data: Reply) => T,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./zip-worker.ts", import.meta.url), { type: "module" });
    const onAbort = () => {
      worker.terminate();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<Reply>) => {
      done();
      if (event.data.error !== undefined) reject(new Error(event.data.error));
      else resolve(pick(event.data));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      done();
      reject(new Error(event.message || "the zip worker stopped"));
    };
    worker.postMessage({ id: 0, ...request }, transfer);
  });
}

/** Reads a zip of boards; see `readBoardZip`. */
export async function readZip(bytes: ArrayBuffer, signal?: AbortSignal): Promise<ZipRead> {
  if (typeof Worker !== "function") {
    const { readBoardZip } = await import("./zip.ts");
    return readBoardZip(new Uint8Array(bytes));
  }
  return inWorker({ op: "read", bytes }, [bytes], (data) => data.read as ZipRead, signal);
}

/** Every file of a zip, checked as `readZip` checks them; see `unpackZip`. */
export async function unpackZipFile(bytes: ArrayBuffer, signal?: AbortSignal): Promise<Unpacked> {
  if (typeof Worker !== "function") {
    const { unpackZip } = await import("./zip.ts");
    return unpackZip(new Uint8Array(bytes));
  }
  return inWorker({ op: "unpack", bytes }, [bytes], (data) => data.unpacked as Unpacked, signal);
}

/** Packs files into a zip; see `writeBoardZip`. */
export async function writeZip(files: ZipFile[], signal?: AbortSignal): Promise<Uint8Array> {
  if (typeof Worker !== "function") {
    const { writeBoardZip } = await import("./zip.ts");
    return writeBoardZip(files);
  }
  return inWorker({ op: "write", files }, [], (data) => data.zip as Uint8Array, signal);
}

const megabytes = (bytes: number) => String(Math.round(bytes / 1024 / 1024));

/** Why a zip was refused, in the reader's language. */
export function describeZipProblem(problem: ZipProblem): string {
  switch (problem.code) {
    case "not-zip":
      return t("zip.problem.notZip");
    case "unsafe-name":
      return t("zip.problem.unsafeName", { name: problem.name });
    case "too-many-entries":
      return t("zip.problem.tooManyEntries", { limit: problem.limit });
    case "too-many-boards":
      return t("zip.problem.tooManyBoards", { limit: problem.limit });
    case "file-too-large":
      return t("zip.problem.fileTooLarge", { name: problem.name, limit: megabytes(problem.limit) });
    case "too-large":
      return t("zip.problem.tooLarge", { limit: megabytes(problem.limit) });
    case "ratio":
      return t("zip.problem.ratio", { name: problem.name, limit: problem.limit });
  }
}

/** Why one file of a zip was left out, in the reader's language. */
export function describeZipNote(note: ZipNote): string {
  switch (note.reason) {
    case "not-board":
      return t("zip.note.notBoard");
    case "image":
      return t("zip.note.image");
    case "duplicate":
      return t("zip.note.duplicate");
    case "scene-shadowed":
      return t("zip.note.sceneShadowed");
    case "overlay-orphan":
      return t("zip.note.overlayOrphan");
    case "invalid-overlay":
      return note.detail
        ? t("zip.note.invalidOverlayDetail", { detail: note.detail })
        : t("zip.note.invalidOverlay");
    case "not-json":
      return t("zip.note.notJson");
    case "invalid-board":
      return note.detail
        ? t("zip.note.invalidBoardDetail", { detail: note.detail })
        : t("zip.note.invalidBoard");
    case "invalid-scene":
      return t("zip.note.invalidScene");
  }
}
