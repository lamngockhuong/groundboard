import * as z from "zod";
import type { Board } from "./board.ts";
import { LIMITS } from "./limits.ts";
import { type Issue, type Result, toIssue } from "./validate.ts";

/**
 * A board's layout overlay, `<slug>.overlay.json` beside `<slug>.board.json`: what a person
 * moved and drew on the canvas. The board file stays the agent's; the overlay stays the
 * person's, and survives the board being written again or laid out anew.
 *
 * `nodes` moves a placed unit (a node at the top level of the layout, or the root of a screen
 * with states, which carries its states along) by an offset from where the layout put it, so
 * a box keeps its nudge when nodes are added and the layout shifts. `notes` are shapes and text
 * drawn on the canvas, a checked subset of Excalidraw elements: geometry, colour, stroke and
 * text only, never a link, an image, an embed or a file.
 */
export const OVERLAY_SCHEMA_VERSION = 1;

/** Excalidraw element types a note may be. */
export const NOTE_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
] as const;

/** Coordinates stay well inside what a canvas can draw; anything past it is a mistake or abuse. */
const MAX_COORDINATE = 1_000_000;
const coordinate = z.number().finite().min(-MAX_COORDINATE).max(MAX_COORDINATE);
const size = z.number().finite().min(0).max(MAX_COORDINATE);
const color = z
  .string()
  .regex(/^(?:#[0-9a-fA-F]{3,8}|transparent)$/, "must be a #hex colour or transparent");
const noteId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "must be letters, digits, '_' or '-', at most 64");

const AnchorSchema = z.strictObject({
  nodeId: z.string().min(1).max(LIMITS.id),
  dx: coordinate,
  dy: coordinate,
});

export const OverlayNoteSchema = z.strictObject({
  id: noteId,
  type: z.enum(NOTE_TYPES),
  /** Absolute position; a note with an `anchor` is drawn relative to its node instead. */
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
  angle: z.number().finite().min(-10).max(10).optional(),
  strokeColor: color.optional(),
  backgroundColor: color.optional(),
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
  strokeWidth: z.number().finite().min(0.5).max(20).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: z.number().finite().min(0).max(2).optional(),
  opacity: z.number().finite().min(0).max(100).optional(),
  /** Points relative to `x`, `y`, for a line, an arrow or a freehand stroke. */
  points: z
    .array(z.tuple([coordinate, coordinate]))
    .max(LIMITS.notePoints)
    .optional(),
  text: z.string().max(LIMITS.longText).optional(),
  fontSize: z.number().finite().min(4).max(200).optional(),
  /** Follows a placed unit: drawn at its top-left plus this offset. */
  anchor: AnchorSchema.optional(),
});

export const OverlaySchema = z.strictObject({
  schemaVersion: z.literal(OVERLAY_SCHEMA_VERSION),
  nodes: z
    .record(z.string().min(1).max(LIMITS.id), z.strictObject({ dx: coordinate, dy: coordinate }))
    .refine((nodes) => Object.keys(nodes).length <= LIMITS.nodes, {
      message: `at most ${LIMITS.nodes} moved nodes`,
    }),
  notes: z.array(OverlayNoteSchema).max(LIMITS.overlayNotes),
});

export type OverlayNote = z.infer<typeof OverlayNoteSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;

/** An overlay that moves nothing and draws nothing. */
export const emptyOverlay = (): Overlay => ({
  schemaVersion: OVERLAY_SCHEMA_VERSION,
  nodes: {},
  notes: [],
});

/** Validates an unknown value as an overlay. Note ids must be unique. */
export function parseOverlay(input: unknown): Result<Overlay, Issue[]> {
  const result = OverlaySchema.safeParse(input);
  if (!result.success) return { ok: false, error: result.error.issues.map(toIssue) };
  const seen = new Set<string>();
  const issues: Issue[] = [];
  result.data.notes.forEach((note, i) => {
    if (seen.has(note.id)) {
      issues.push({ path: `notes[${i}].id`, message: `note id \`${note.id}\` is used twice` });
    }
    seen.add(note.id);
  });
  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: result.data };
}

/** Whether an overlay moves or draws anything. */
export function isEmptyOverlay(overlay: Overlay): boolean {
  return Object.keys(overlay.nodes).length === 0 && overlay.notes.length === 0;
}

/**
 * The placed unit each node of a board belongs to, the id an overlay moves it by: a node at the
 * top level of the layout is its own unit; a screen with states, its states and every element
 * of them belong to the root screen; an endpoint belongs to its resource.
 */
export function placedUnits(board: Pick<Board, "nodes">): Map<string, string> {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const stateRoot = new Map<string, string>();
  for (const node of board.nodes) {
    if (node.kind !== "screen" || node.stateOf === undefined || node.stateOf === node.id) continue;
    const root = byId.get(node.stateOf);
    if (root?.kind === "screen" && root.stateOf === undefined) stateRoot.set(node.id, root.id);
  }
  const units = new Map<string, string>();
  for (const node of board.nodes) {
    let current = node;
    const seen = new Set<string>();
    // An element sits in a screen, an endpoint in its resource: they move with it.
    while (
      (current.kind === "element" || current.kind === "endpoint") &&
      current.parentId !== undefined &&
      !seen.has(current.id)
    ) {
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    units.set(
      node.id,
      current.kind === "screen" ? (stateRoot.get(current.id) ?? current.id) : current.id,
    );
  }
  return units;
}

/**
 * What of an overlay matches nothing on its board, found without laying the board out: an
 * offset for a node that is not on the board or that moves with another unit, and a note
 * anchored to a node that is not on the board. The overlay still applies; these entries do not.
 */
export function overlayOrphans(board: Board, overlay: Overlay): string[] {
  const units = placedUnits(board);
  const refs = new Set(
    board.edges.flatMap((e) => (e.toRef !== undefined ? [`@ref:${e.toRef}`] : [])),
  );
  const orphans: string[] = [];
  for (const id of Object.keys(overlay.nodes)) {
    if (refs.has(id)) continue;
    const unit = units.get(id);
    if (unit === undefined)
      orphans.push(`overlay: \`${id}\` is not on the board; its offset is ignored`);
    else if (unit !== id)
      orphans.push(`overlay: \`${id}\` moves with \`${unit}\`; its own offset is ignored`);
  }
  for (const note of overlay.notes) {
    if (note.anchor && !units.has(note.anchor.nodeId)) {
      orphans.push(
        `overlay: note \`${note.id}\` follows \`${note.anchor.nodeId}\`, which is not on the board; it stays where it was drawn`,
      );
    }
  }
  return orphans;
}
