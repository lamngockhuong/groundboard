import path from "node:path";
import { FIGMA_CACHE_DIR } from "@groundboard/schema";
import { MAX_BOARD_FILE_BYTES, staleSourceIds } from "./atlas.ts";
import { BOARD_FILE_SUFFIX, readConfined } from "./fs-confined.ts";
import type { RenderFn } from "./mcp/tools.ts";
import { readOverlayFile } from "./overlay-file.ts";
import { renderBoard } from "./pipeline.ts";
import type { ReferenceOptions } from "./references.ts";

export interface AtlasBoardOptions {
  /**
   * Draw the cached Figma image of each frame (`<dir>/.cache/figma`). `false` leaves them out;
   * an object keeps them and overrides the size caps.
   */
  references?: boolean | Pick<ReferenceOptions, "maxImageBytes" | "maxBoardBytes">;
  /** Lays the board out; defaults to the in-process pipeline. */
  render?: RenderFn;
}

/** One atlas board as `GET /api/atlas/boards/:slug` returns it, with its HTTP status. */
export type AtlasBoardResponse =
  | { status: 200; body: Record<string, unknown>; source: string; overlay?: string }
  | { status: 404; body: { error: string } }
  | {
      status: 422;
      body: { status: "invalid"; issues: unknown[]; warnings?: string[] };
      source: string;
      overlay?: string;
    };

/**
 * Reads `<slug>.board.json` from the atlas directory `dir` (a real path, never through a
 * symlink), checks its sources against `root` and renders it, stale or not. The server's board
 * route and `groundboard export` both build their JSON here, so the two never differ. The slug
 * must already match `BOARD_SLUG`. Each response but a 404 carries `source`, the board file as
 * read, and `overlay`, the layout overlay beside it when there is a valid one, which the export
 * embeds beside the rendered board. The overlay is applied; an invalid one is left out with a
 * warning.
 */
export async function renderAtlasBoard(
  dir: string,
  root: string,
  slug: string,
  options: AtlasBoardOptions = {},
): Promise<AtlasBoardResponse> {
  const read = await readConfined(
    dir,
    `${slug}${BOARD_FILE_SUFFIX}`,
    { remaining: MAX_BOARD_FILE_BYTES },
    MAX_BOARD_FILE_BYTES,
    { noSymlink: true },
  );
  if (!read.ok) return { status: 404, body: { error: "no such board" } };
  const overlay = await readOverlayFile(dir, slug);
  const overlayText = overlay.status === "ok" ? { overlay: overlay.text } : {};
  let input: unknown;
  try {
    input = JSON.parse(read.text);
  } catch {
    return {
      status: 422,
      body: { status: "invalid", issues: [{ path: "", message: "the board is not valid JSON" }] },
      source: read.text,
      ...overlayText,
    };
  }
  const references = options.references ?? true;
  const render = options.render ?? renderBoard;
  const result = await render(input, {
    ...(overlay.status === "ok" ? { overlay: overlay.overlay } : {}),
    checkSourcesRoot: root,
    onStaleSources: "render",
    ...(references
      ? {
          references: {
            dir: path.join(dir, FIGMA_CACHE_DIR),
            within: dir,
            ...(typeof references === "object" ? references : {}),
          },
        }
      : {}),
  });
  if (!result.ok || !result.scene) {
    return {
      status: 422,
      body: { status: "invalid", issues: result.issues, warnings: result.warnings },
      source: read.text,
      ...overlayText,
    };
  }
  const sources = (input as { sources?: Array<{ id?: unknown }> }).sources ?? [];
  return {
    status: 200,
    body: {
      scene: result.scene,
      status: result.stale ? "stale" : "ok",
      warnings:
        overlay.status === "invalid" ? [...result.warnings, overlay.warning] : result.warnings,
      staleSourceIds: staleSourceIds(result.staleIssues ?? [], sources),
      ...(result.references ? { references: result.references } : {}),
    },
    source: read.text,
    ...overlayText,
  };
}
