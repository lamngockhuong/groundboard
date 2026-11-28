import { type Board, type BoardEdge, screenFamilies, takesRef } from "@groundboard/schema";
import { isRowTagEdge } from "./card.ts";
import { measureText } from "./measure.ts";
import { edgeLabelText, SMALL_FONT_SIZE } from "./text.ts";
import type { LaidOutText } from "./types.ts";
import type { ScreenLayout } from "./wireframe.ts";

/**
 * On a screen board, a `navigates` edge to a screen on another board is not drawn as an arrow
 * to a chip: its source gets a small numbered tag, and a list beside the frame names the target
 * of each number. Everything here is relative to the top-left corner of the frame's body (below
 * the title band), so the layout can reserve the room before ELK places the frame.
 */

/** Distance a local route runs outside the frame's right edge. */
export const LOCAL_ROUTE_OFFSET = 16;
/** Space between the frame (or the last local route label) and the list. */
const LIST_GAP = 16;
/** Space between the vertical run of a local route and its label. */
const LOCAL_LABEL_OFFSET = 4;
const LINE_GAP = 4;
export const TAG_FONT_SIZE = 12;
const TAG_HEIGHT = 16;
const TAG_PAD_X = 4;
const TAG_GAP = 4;
/** How far a tag reaches past its element's right edge. */
const TAG_OVERHANG = 6;
/** How far a tag reaches into its element, from the top. */
const TAG_OVERLAP = 4;
/** Room kept clear around the y where a same-board arrow leaves or enters an element. */
const STUB_CLEARANCE = 4;
/** Distance between the stubs of several arrows on one element (see `startOf` in screen-states). */
const STUB_SPACING = 6;
/** Where the exit slots of arrows that leave a frame of a state family start, and their spacing. */
const SLOT_TOP = 20;
const EXIT_SPACING = 12;

export interface FrameRefMarker {
  edgeId: string;
  number: number;
  tag: LaidOutText;
  line: LaidOutText;
}

export interface FrameMarkers {
  /** Room right of the frame that the list needs, local routes included. */
  width: number;
  /** Bottom of the list; it may lie below the frame's body. */
  bottom: number;
  markers: FrameRefMarker[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Whether an edge is drawn as a tag and a list line rather than an arrow to a chip. */
function isMarkerEdge(
  edge: BoardEdge,
  screens: ReadonlyMap<string, ScreenLayout>,
  screenOf: ReadonlyMap<string, string>,
  kindOf: ReadonlyMap<string, string>,
): boolean {
  // Any edge that may point across boards, out of a card with rows: a screen, a resource. A
  // read, write or enqueue out of an endpoint is a tag in its row instead.
  if (edge.toRef === undefined || !takesRef(edge.kind)) return false;
  if (isRowTagEdge(edge, kindOf)) return false;
  if (screenOf.has(edge.from)) return true;
  return (screens.get(edge.from)?.boxes.length ?? 0) > 0;
}

/**
 * Room right of each frame that its local routes (edges between two parts of one frame) and
 * their labels take, by frame id. Frames without local routes are not listed.
 */
export function localRouteRoom(
  board: Board,
  screenOf: ReadonlyMap<string, string>,
): Map<string, number> {
  const frameOf = (nodeId: string) => screenOf.get(nodeId) ?? nodeId;
  const labelWidth = new Map<string, number>();
  for (const edge of board.edges) {
    if (edge.to === undefined) continue;
    const fromFrame = frameOf(edge.from);
    if (fromFrame !== frameOf(edge.to)) continue;
    if (!screenOf.has(edge.from) && !screenOf.has(edge.to)) continue;
    const width = edge.label ? measureText(edgeLabelText(edge.label), SMALL_FONT_SIZE).width : 0;
    labelWidth.set(fromFrame, Math.max(labelWidth.get(fromFrame) ?? 0, width));
  }
  const room = new Map<string, number>();
  for (const [frame, width] of labelWidth) {
    room.set(frame, LOCAL_ROUTE_OFFSET + LOCAL_LABEL_OFFSET + width);
  }
  return room;
}

/**
 * The tags and the list of every frame with a `toRef` edge out of it or out of one of its
 * elements. `screens` holds the wireframe of every screen, `screenOf` the frame of each
 * element. A frame without elements (an overview board) gets none: its edges keep their chips.
 */
export function layoutRefMarkers(
  board: Board,
  screens: ReadonlyMap<string, ScreenLayout>,
  screenOf: ReadonlyMap<string, string>,
): Map<string, FrameMarkers> {
  const frameOf = (nodeId: string) => screenOf.get(nodeId) ?? nodeId;
  const byFrame = new Map<string, BoardEdge[]>();
  const kindOf = new Map(board.nodes.map((n) => [n.id, n.kind]));
  for (const edge of board.edges) {
    if (!isMarkerEdge(edge, screens, screenOf, kindOf)) continue;
    const frame = frameOf(edge.from);
    byFrame.set(frame, [...(byFrame.get(frame) ?? []), edge]);
  }

  // Local routes run beside the frame; the list goes right of them and their labels.
  const localRoom = localRouteRoom(board, screenOf);
  /** Per frame, y ranges where a same-board arrow crosses the gutter into an element. */
  const stubs = new Map<string, Array<[number, number]>>();
  const stubCount = new Map<string, number>();
  /** Arrows that leave a frame of a state family from the frame itself, through a slot. */
  const slotCount = new Map<string, number>();
  const inFamily = new Set<string>();
  for (const [rootId, states] of screenFamilies(board)) {
    inFamily.add(rootId);
    for (const state of states) inFamily.add(state);
  }
  for (const edge of board.edges) {
    if (edge.to === undefined) continue;
    const fromFrame = frameOf(edge.from);
    const toFrame = frameOf(edge.to);
    const touchesElement = screenOf.has(edge.from) || screenOf.has(edge.to);
    if (fromFrame === toFrame && touchesElement) continue;
    for (const end of [edge.from, edge.to]) {
      if (screenOf.has(end)) stubCount.set(end, (stubCount.get(end) ?? 0) + 1);
    }
    if (inFamily.has(edge.from)) slotCount.set(edge.from, (slotCount.get(edge.from) ?? 0) + 1);
  }
  for (const [frame, count] of slotCount) {
    stubs.set(frame, [
      [SLOT_TOP - STUB_CLEARANCE, SLOT_TOP + (count - 1) * EXIT_SPACING + STUB_CLEARANCE],
    ]);
  }
  for (const [elementId, count] of stubCount) {
    const frame = screenOf.get(elementId) as string;
    const box = screens.get(frame)?.boxes.find((b) => b.id === elementId);
    if (box === undefined) continue;
    const mid = box.y + box.height / 2;
    stubs.set(frame, [
      ...(stubs.get(frame) ?? []),
      [mid - STUB_CLEARANCE, mid + (count - 1) * STUB_SPACING + STUB_CLEARANCE],
    ]);
  }

  // Text and links are drawn as bare text: their tag goes on the text, not on the wider box.
  const bare = new Set(
    board.nodes.filter((n) => n.role === "text" || n.role === "link").map((n) => n.id),
  );
  const out = new Map<string, FrameMarkers>();
  for (const [frame, edges] of byFrame) {
    const screen = screens.get(frame) as ScreenLayout;
    const boxes = new Map(screen.boxes.map((b) => [b.id, b]));
    /** What the reader sees of an element, where its tag goes. */
    const anchors = new Map(
      screen.boxes.map((b) => [
        b.id,
        bare.has(b.id) ? { x: b.textX, y: b.textY, width: b.textWidth, height: b.textHeight } : b,
      ]),
    );
    // Sources top to bottom, then left to right; the frame itself, whose tags sit in its title
    // band, comes first. Ties keep board order (the sort is stable).
    const position = (edge: BoardEdge): [number, number] => {
      const box = boxes.get(edge.from);
      return box === undefined ? [-Infinity, -Infinity] : [box.y, box.x];
    };
    const ordered = [...edges].sort((a, b) => {
      const [ay, ax] = position(a);
      const [by, bx] = position(b);
      return ay === by ? (ax === bx ? 0 : ax - bx) : ay - by;
    });

    const listX = screen.width + (localRoom.get(frame) ?? 0) + LIST_GAP;
    const blocked = [...(stubs.get(frame) ?? [])].sort((a, b) => a[0] - b[0]);

    const markers: FrameRefMarker[] = [];
    let previousBottom = -Infinity;
    let right = listX;
    ordered.forEach((edge, i) => {
      const number = i + 1;
      // A long label wraps as an arrow label does; the ref is never broken.
      const label = edge.label ? `${edgeLabelText(edge.label)} ` : "";
      const content = `${number} ${label}→ ${edge.toRef}`;
      const size = measureText(content, SMALL_FONT_SIZE);
      const anchor = anchors.get(edge.from);
      let y = Math.max(anchor === undefined ? 0 : anchor.y - 2, previousBottom + LINE_GAP);
      // Keep the line off the y where a same-board arrow runs out to the gutter.
      for (const [lo, hi] of blocked) {
        if (y < hi && y + size.height > lo) y = hi;
      }
      previousBottom = y + size.height;
      right = Math.max(right, listX + size.width);
      markers.push({
        edgeId: edge.id,
        number,
        tag: { text: String(number), fontSize: TAG_FONT_SIZE, x: 0, y: 0, width: 0, height: 0 },
        line: {
          text: content,
          fontSize: SMALL_FONT_SIZE,
          x: round(listX),
          y: round(y),
          width: size.width,
          height: size.height,
        },
      });
    });

    // Tags: side by side on the source's top-right corner, numbers rising left to right; the
    // frame's own tags at the right end of its title band.
    const bySource = new Map<string, FrameRefMarker[]>();
    ordered.forEach((edge, i) => {
      bySource.set(edge.from, [...(bySource.get(edge.from) ?? []), markers[i] as FrameRefMarker]);
    });
    for (const [source, group] of bySource) {
      const widths = group.map((m) =>
        Math.max(TAG_HEIGHT, measureText(m.tag.text, TAG_FONT_SIZE).width + 2 * TAG_PAD_X),
      );
      const total = widths.reduce((sum, w) => sum + w, 0) + TAG_GAP * (group.length - 1);
      const box = anchors.get(source);
      const rightEdge = box === undefined ? screen.width : box.x + box.width + TAG_OVERHANG;
      const top = box === undefined ? -TAG_HEIGHT - 6 : box.y - TAG_HEIGHT + TAG_OVERLAP;
      let x = rightEdge - total;
      group.forEach((marker, i) => {
        const width = widths[i] as number;
        marker.tag = {
          ...marker.tag,
          x: round(x),
          y: round(top),
          width: round(width),
          height: TAG_HEIGHT,
        };
        x += width + TAG_GAP;
      });
    }

    out.set(frame, {
      width: Math.ceil(right - screen.width),
      bottom: Math.ceil(Math.max(0, ...markers.map((m) => m.line.y + m.line.height))),
      markers,
    });
  }
  return out;
}
