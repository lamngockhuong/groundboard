import { layoutBoard } from "@groundboard/layout/layout";
import { applyOverlay, type PlacedNote } from "@groundboard/layout/overlay";
import { renderExcalidraw } from "@groundboard/render-excalidraw";
import { lintBoardText, lintOverlayText, parseBoard, parseOverlay } from "@groundboard/schema";

/**
 * The server's render pipeline, run in the browser: validate → layout → render. There are no
 * files to compare quotes with, so the scene says its sources were not checked.
 */
export type LocalRenderResult =
  | { status: "ok"; scene: unknown; warnings: string[] }
  | { status: "invalid"; issues: Array<{ path: string; message: string }>; warnings: string[] }
  | { status: "error"; message: string };

export async function renderBoardLocally(
  input: unknown,
  overlayInput?: unknown,
): Promise<LocalRenderResult> {
  const parsed = parseBoard(input);
  if (!parsed.ok) return { status: "invalid", issues: parsed.error, warnings: [] };
  const board = parsed.value;
  try {
    let laidOut = await layoutBoard(board, { direction: "right" });
    const warnings = lintBoardText(board);
    let notes: PlacedNote[] = [];
    if (overlayInput !== undefined && overlayInput !== null) {
      // The same rule as the server's: an overlay that fails its schema is left out, with a warning.
      const overlay = parseOverlay(overlayInput);
      if (overlay.ok) {
        const applied = applyOverlay(laidOut, board, overlay.value);
        laidOut = applied.laidOut;
        notes = applied.notes;
        warnings.push(...applied.warnings, ...lintOverlayText(overlay.value));
      } else {
        warnings.push("overlay ignored: it does not match the overlay schema");
      }
    }
    const scene = renderExcalidraw(laidOut, board, {
      sourcesChecked: null,
      ...(notes.length > 0 ? { notes } : {}),
    });
    return { status: "ok", scene, warnings };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
