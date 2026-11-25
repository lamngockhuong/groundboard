import {
  applyOverlay,
  type Direction,
  type LaidOutBoard,
  layoutBoard,
  layoutInWorker,
  type PlacedNote,
} from "@groundboard/layout";
import {
  type ExcalidrawScene,
  renderExcalidraw,
  type SourcesChecked,
} from "@groundboard/render-excalidraw";
import {
  type Board,
  type Issue,
  lintBoardText,
  lintOverlayText,
  parseBoard,
  parseOverlay,
} from "@groundboard/schema";
import { checkSources } from "./check-sources.ts";
import {
  type LoadedReferences,
  loadReferences,
  type ReferenceCount,
  type ReferenceOptions,
} from "./references.ts";

export type OutputFormat = "excalidraw";
export const OUTPUT_FORMATS: readonly OutputFormat[] = ["excalidraw"];

export interface RenderBoardOptions {
  to?: OutputFormat;
  direction?: Direction;
  /** Check every cited quote against the files under this directory. */
  checkSourcesRoot?: string;
  /** Run layout in a worker thread with this hard time limit (used by the HTTP server). */
  workerTimeoutMs?: number;
  /**
   * What a failed source check does: `fail` (default) stops rendering; `render` draws the
   * board anyway, marked "Sources NOT checked", and reports it as stale. A board whose
   * schema check fails is never rendered.
   */
  onStaleSources?: "fail" | "render";
  /**
   * Draw the cached Figma image of each frame beside it, read from this cache directory.
   * Off unless given; MCP `render_board` never passes it.
   */
  references?: ReferenceOptions;
  /**
   * The board's layout overlay (`<slug>.overlay.json`), as read: moved boxes and drawn notes.
   * One that fails its schema is left out with a warning; the board still renders.
   */
  overlay?: unknown;
}

export interface RenderBoardResult {
  ok: boolean;
  scene?: ExcalidrawScene;
  /** Errors that stopped rendering: invalid board or failed source check. */
  issues: Issue[];
  /** Things the caller should know that did not stop rendering. */
  warnings: string[];
  sourcesChecked: SourcesChecked | null;
  /** With `onStaleSources: "render"`: the board rendered although its source check failed. */
  stale?: boolean;
  /** The source-check issues of a stale board. */
  staleIssues?: Issue[];
  /** With `references`: frames that cite a Figma frame, and how many of them were drawn. */
  references?: ReferenceCount;
}

export const SOURCES_NOT_CHECKED =
  "sources not checked: citations were not compared with any files, and the board says so";

export interface ValidateResult {
  ok: boolean;
  board?: Board;
  issues: Issue[];
  warnings: string[];
  sourcesChecked: SourcesChecked | null;
}

/** Validates a board and, when a root is given, checks its sources against the files. */
export async function validateBoard(
  input: unknown,
  options: Pick<RenderBoardOptions, "checkSourcesRoot"> = {},
): Promise<ValidateResult> {
  const parsed = parseBoard(input);
  if (!parsed.ok) return { ok: false, issues: parsed.error, warnings: [], sourcesChecked: null };
  const board = parsed.value;
  const textWarnings = lintBoardText(board);
  if (options.checkSourcesRoot === undefined) {
    return {
      ok: true,
      board,
      issues: [],
      warnings: [SOURCES_NOT_CHECKED, ...textWarnings],
      sourcesChecked: null,
    };
  }
  const checked = await checkSources(board, options.checkSourcesRoot);
  return {
    ok: checked.issues.length === 0,
    board,
    issues: checked.issues,
    warnings: textWarnings,
    sourcesChecked: checked.sourcesChecked,
  };
}

/** validate → (check sources) → layout → render. Every surface (CLI, MCP, HTTP) calls this. */
export async function renderBoard(
  input: unknown,
  options: RenderBoardOptions = {},
): Promise<RenderBoardResult> {
  const to = options.to ?? "excalidraw";
  if (!OUTPUT_FORMATS.includes(to)) {
    return {
      ok: false,
      issues: [{ path: "", message: `unknown output format ${JSON.stringify(to)}` }],
      warnings: [],
      sourcesChecked: null,
    };
  }
  const validated = await validateBoard(input, options);
  // A parsed board that only failed its source check is stale, and may still be drawn.
  const stale = !validated.ok && validated.board !== undefined;
  if (!validated.board || (stale && options.onStaleSources !== "render")) {
    return {
      ok: false,
      issues: validated.issues,
      warnings: validated.warnings,
      sourcesChecked: null,
    };
  }
  const board = validated.board;
  const direction = options.direction ?? "right";
  const references: LoadedReferences | undefined =
    options.references === undefined ? undefined : await loadReferences(board, options.references);
  const sizes = references !== undefined && references.cached > 0 ? references.sizes : undefined;
  const laidOut: LaidOutBoard =
    options.workerTimeoutMs !== undefined
      ? await layoutInWorker(board, {
          direction,
          timeoutMs: options.workerTimeoutMs,
          ...(sizes ? { references: sizes } : {}),
        })
      : await layoutBoard(board, { direction, ...(sizes ? { references: sizes } : {}) });
  const overlaid = withOverlay(laidOut, board, options.overlay);
  const sourcesChecked = stale ? null : validated.sourcesChecked;
  const scene = renderExcalidraw(overlaid.laidOut, board, {
    sourcesChecked,
    ...(sizes && references ? { references: references.images } : {}),
    ...(overlaid.notes.length > 0 ? { notes: overlaid.notes } : {}),
  });
  return {
    ok: true,
    scene,
    issues: [],
    warnings: [...validated.warnings, ...(references?.warnings ?? []), ...overlaid.warnings],
    sourcesChecked,
    ...(stale ? { stale: true, staleIssues: validated.issues } : {}),
    ...(references ? { references: { frames: references.frames, cached: references.cached } } : {}),
  };
}

/**
 * Applies a layout overlay read from disk or sent by the viewer. A missing overlay changes
 * nothing; one that fails its schema is left out with a warning, never failing the board.
 */
export function withOverlay(
  laidOut: LaidOutBoard,
  board: Board,
  raw: unknown,
): { laidOut: LaidOutBoard; notes: PlacedNote[]; warnings: string[] } {
  if (raw === undefined || raw === null) return { laidOut, notes: [], warnings: [] };
  const parsed = parseOverlay(raw);
  if (!parsed.ok) {
    const first = parsed.error[0];
    return {
      laidOut,
      notes: [],
      warnings: [
        `overlay ignored: it does not match the overlay schema${first ? ` (${first.path ? `${first.path}: ` : ""}${first.message})` : ""}`,
      ],
    };
  }
  const applied = applyOverlay(laidOut, board, parsed.value);
  return { ...applied, warnings: [...applied.warnings, ...lintOverlayText(parsed.value)] };
}
