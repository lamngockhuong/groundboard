import {
  type Board,
  type BoardNode,
  type ElementRole,
  MIN_WRAP_WIDTH,
  type Platform,
  rowCells,
  SCREEN_WIDTH,
  WIREFRAME_GAP,
  WIREFRAME_PADDING,
} from "@groundboard/schema";
import { measureText, wrapText } from "./measure.ts";
import { FONT_SIZE, SMALL_FONT_SIZE } from "./text.ts";

/** Default content width of a screen frame by platform; `screen.width` overrides it. */
export { SCREEN_WIDTH };
/**
 * Size of a frame with no elements: a state of a screen drawn before its wireframe. A screen
 * with neither elements nor states is a plain labelled box instead.
 */
export const EMPTY_SCREEN_SIZE: Record<Platform, { width: number; height: number }> = {
  web: { width: 240, height: 150 },
  mobile: { width: 150, height: 260 },
};
/** Room above a frame for the name Excalidraw draws there. */
export const FRAME_TITLE_HEIGHT = 32;

const PADDING = WIREFRAME_PADDING;
const GAP = WIREFRAME_GAP;
const TEXT_PAD_X = 10;
const TEXT_PAD_Y = 8;
/** Plain text and links sit closer to their box. */
const BARE_TEXT_PAD = 4;
/** Space a checkbox square or an icon circle takes left of its label. */
const MARK_WIDTH = { checkbox: 28, icon: 40 } as const;

const MIN_HEIGHT: Record<ElementRole, number> = {
  container: 0,
  text: 0,
  link: 0,
  button: 40,
  input: 44,
  checkbox: 28,
  image: 120,
  icon: 32,
  bar: 56,
};
const IMAGE_IN_ROW_HEIGHT = 64;

/** A laid-out element, relative to the screen's top-left corner. */
export interface WireBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Wrapped text to draw; for an element with children, a small caption at its top. */
  text: string;
  fontSize: number;
  textX: number;
  textY: number;
  textWidth: number;
  textHeight: number;
}

export interface ScreenLayout {
  width: number;
  height: number;
  /** Elements parent before children (depth first), so a renderer draws children on top. */
  boxes: WireBox[];
}

/** The label of an element wrapped to the inner width of its box; never a citation. */
export function elementText(
  node: Pick<BoardNode, "label">,
  innerWidth: number,
  fontSize = FONT_SIZE,
): string {
  return wrapText(node.label, Math.max(MIN_WRAP_WIDTH, innerWidth), fontSize);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Elements grouped by parent id, each list in board order. */
export function childrenByParent(board: Pick<Board, "nodes">): Map<string, BoardNode[]> {
  const children = new Map<string, BoardNode[]>();
  for (const node of board.nodes) {
    if (node.kind !== "element" || node.parentId === undefined) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  return children;
}

/**
 * Stacks a screen's element tree in rows and columns. Pure and deterministic: a column gives
 * each child the parent's inner width, a row gives a child with `width` that width and splits
 * the rest evenly among the others, and every box is at least as tall as its role's minimum
 * and its wrapped label. The frame is `screen.width` wide, or the platform's default width.
 */
export function layoutScreen(screen: BoardNode, children: Map<string, BoardNode[]>): ScreenLayout {
  const platform: Platform = screen.platform ?? "web";
  const top = children.get(screen.id) ?? [];
  if (top.length === 0) return { ...EMPTY_SCREEN_SIZE[platform], boxes: [] };

  const width = screen.width ?? SCREEN_WIDTH[platform];
  const boxes: WireBox[] = [];

  const place = (
    node: BoardNode,
    x: number,
    y: number,
    boxWidth: number,
    inRow: boolean,
  ): number => {
    const role = node.role ?? "container";
    const kids = children.get(node.id) ?? [];
    const index = boxes.length;
    if (kids.length > 0) {
      const inner = Math.max(0, boxWidth - 2 * PADDING);
      const text = elementText(node, inner, SMALL_FONT_SIZE);
      const size = measureText(text, SMALL_FONT_SIZE);
      boxes.push(
        box(node.id, x, y, boxWidth, 0, text, SMALL_FONT_SIZE, x + PADDING, y + PADDING, size),
      );
      const contentTop = y + PADDING + size.height + GAP;
      const contentBottom = stack(kids, node.direction ?? "column", x + PADDING, contentTop, inner);
      const height = Math.max(MIN_HEIGHT[role], contentBottom - y + PADDING);
      (boxes[index] as WireBox).height = round(height);
      return height;
    }
    const mark = role === "checkbox" || role === "icon" ? MARK_WIDTH[role] : 0;
    const padX = role === "text" || role === "link" ? BARE_TEXT_PAD : TEXT_PAD_X;
    const padY = role === "text" || role === "link" ? BARE_TEXT_PAD : TEXT_PAD_Y;
    const textWidthLimit = Math.max(0, boxWidth - 2 * padX - mark);
    const text = elementText(node, textWidthLimit);
    const size = measureText(text, FONT_SIZE);
    const minHeight = role === "image" && inRow ? IMAGE_IN_ROW_HEIGHT : MIN_HEIGHT[role];
    const height = Math.max(minHeight, size.height + 2 * padY);
    const centred = role === "button" || role === "image";
    const textX = centred ? x + (boxWidth - size.width) / 2 : x + padX + mark;
    const textY = y + (height - size.height) / 2;
    boxes.push(box(node.id, x, y, boxWidth, height, text, FONT_SIZE, textX, textY, size));
    return height;
  };

  /** Places `nodes` from (x, y) inside `inner` width; returns the bottom edge. */
  const stack = (
    nodes: BoardNode[],
    direction: "row" | "column",
    x: number,
    y: number,
    inner: number,
  ): number => {
    if (direction === "column") {
      let cursor = y;
      nodes.forEach((child, i) => {
        if (i > 0) cursor += GAP;
        cursor += place(child, x, cursor, inner, false);
      });
      return cursor;
    }
    const cells = rowCells(
      inner,
      nodes.map((child) => child.width),
    );
    let tallest = 0;
    nodes.forEach((child, i) => {
      const cell = cells[i] as { x: number; width: number };
      tallest = Math.max(tallest, place(child, x + cell.x, y, cell.width, true));
    });
    return y + tallest;
  };

  const bottom = stack(top, screen.direction ?? "column", PADDING, PADDING, width - 2 * PADDING);
  return { width, height: round(bottom + PADDING), boxes };
}

function box(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fontSize: number,
  textX: number,
  textY: number,
  size: { width: number; height: number },
): WireBox {
  return {
    id,
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    text,
    fontSize,
    textX: round(textX),
    textY: round(textY),
    textWidth: size.width,
    textHeight: size.height,
  };
}
