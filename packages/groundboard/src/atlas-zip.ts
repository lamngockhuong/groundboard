import { realpath } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import { BOARD_SLUG, MAX_ATLAS_BOARDS, MAX_ATLAS_BYTES, MAX_BOARD_FILE_BYTES } from "./atlas.ts";
import { renderAtlasBoard } from "./atlas-board.ts";
import { BOARD_FILE_SUFFIX, listBoardFiles, readConfined } from "./fs-confined.ts";
import type { RenderFn } from "./mcp/tools.ts";
import { OVERLAY_FILE_SUFFIX, readOverlayFile } from "./overlay-file.ts";

export interface AtlasZipOptions {
  /** Add each board rendered, as `.groundboard/<slug>.excalidraw`, without Figma images. */
  scenes?: boolean;
  render?: RenderFn;
}

/**
 * Packs the atlas into the zip the viewer reads back: `.groundboard/<slug>.board.json` and its
 * layout overlay `<slug>.overlay.json` as written, the rendered scenes when asked for, and `errors.txt` naming the boards that could
 * not be read or rendered. The first `MAX_ATLAS_BOARDS` boards by name are packed, read with
 * the same byte budget as the atlas index.
 */
export async function buildAtlasZip(
  dir: string,
  root: string,
  options: AtlasZipOptions = {},
): Promise<Uint8Array> {
  const realDir = await realpath(dir);
  const budget = { remaining: MAX_ATLAS_BYTES };
  const files: Record<string, Uint8Array> = {};
  const errors: string[] = [];
  const slugs = (await listBoardFiles(realDir))
    .map((name) => name.slice(0, -BOARD_FILE_SUFFIX.length))
    .filter((slug) => BOARD_SLUG.test(slug))
    .slice(0, MAX_ATLAS_BOARDS);
  for (const slug of slugs) {
    const name = `${slug}${BOARD_FILE_SUFFIX}`;
    const read = await readConfined(realDir, name, budget, MAX_BOARD_FILE_BYTES, {
      noSymlink: true,
    });
    if (!read.ok) {
      errors.push(`${name}: the board file ${read.reason}`);
      continue;
    }
    files[`.groundboard/${name}`] = strToU8(read.text);
    const overlay = await readOverlayFile(realDir, slug);
    if (overlay.status === "ok") {
      files[`.groundboard/${slug}${OVERLAY_FILE_SUFFIX}`] = strToU8(overlay.text);
    } else if (overlay.status === "invalid") {
      errors.push(overlay.warning);
    }
    if (!options.scenes) continue;
    const rendered = await renderAtlasBoard(realDir, root, slug, {
      references: false,
      ...(options.render ? { render: options.render } : {}),
    });
    if (rendered.status === 200) {
      // The rendered scene is a whole `.excalidraw` document already.
      files[`.groundboard/${slug}.excalidraw`] = strToU8(JSON.stringify(rendered.body.scene));
    } else if (rendered.status === 422) {
      const issues = rendered.body.issues as Array<{ path?: string; message?: string }>;
      const first = issues[0];
      errors.push(
        `${name}: not rendered${first ? ` (${first.path ? `${first.path}: ` : ""}${first.message ?? ""})` : ""}`,
      );
    }
  }
  if (errors.length > 0) files["errors.txt"] = strToU8(`${errors.join("\n")}\n`);
  return zipSync(files, { level: 6 });
}
