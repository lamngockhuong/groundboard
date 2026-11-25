import { readdir } from "node:fs/promises";
import { LIMITS, type Overlay, parseOverlay } from "@groundboard/schema";
import { readConfined } from "./fs-confined.ts";

export const OVERLAY_FILE_SUFFIX = ".overlay.json";

export type OverlayRead =
  | { status: "none" }
  | { status: "invalid"; warning: string }
  | { status: "ok"; overlay: Overlay; text: string };

/**
 * Reads `<slug>.overlay.json` from the atlas directory `dir` (a real path), never through a
 * symlink and at most `LIMITS.overlayBytes`. A missing file is `none`; one that cannot be read,
 * is not JSON or fails the overlay schema is `invalid`, with a warning that quotes no content.
 */
export async function readOverlayFile(dir: string, slug: string): Promise<OverlayRead> {
  const read = await readConfined(
    dir,
    `${slug}${OVERLAY_FILE_SUFFIX}`,
    { remaining: LIMITS.overlayBytes },
    LIMITS.overlayBytes,
    { noSymlink: true },
  );
  if (!read.ok) {
    return read.reason === "file not found"
      ? { status: "none" }
      : {
          status: "invalid",
          warning: `${slug}${OVERLAY_FILE_SUFFIX} ignored: the file ${read.reason}`,
        };
  }
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    return { status: "invalid", warning: `${slug}${OVERLAY_FILE_SUFFIX} ignored: not valid JSON` };
  }
  const parsed = parseOverlay(json);
  if (!parsed.ok) {
    const first = parsed.error[0];
    return {
      status: "invalid",
      warning: `${slug}${OVERLAY_FILE_SUFFIX} ignored: ${first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "it does not match the overlay schema"}`,
    };
  }
  return { status: "ok", overlay: parsed.value, text: read.text };
}

/** Slugs of the overlay files directly in `dir`, sorted; symlinks and directories are skipped. */
export async function listOverlaySlugs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(OVERLAY_FILE_SUFFIX))
    .map((e) => e.name.slice(0, -OVERLAY_FILE_SUFFIX.length))
    .sort();
}
