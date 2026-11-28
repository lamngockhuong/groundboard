import type { BoardNode, NodeKind } from "@groundboard/schema";
import { measureText, type TextSize, wrapText } from "./measure.ts";
import type { NodeShape } from "./types.ts";

/** Font size of node text. Layout measures with it and renderers draw with it. */
export const FONT_SIZE = 16;
/** Font size of edge labels and nested-group labels. */
export const SMALL_FONT_SIZE = 14;
/** Node text wraps at this width in pixels. */
export const MAX_TEXT_WIDTH = 260;
/** Edge labels wrap at this width in pixels. */
export const MAX_EDGE_LABEL_WIDTH = 160;
/** Excalidraw's padding between a container and its bound text. */
export const BOUND_TEXT_PADDING = 5;

export const NODE_SHAPES: Record<NodeKind, NodeShape> = {
  step: "rectangle",
  fact: "rectangle",
  cause: "rectangle",
  rejected: "rectangle",
  question: "rectangle",
  state: "ellipse",
  decision: "diamond",
  note: "text",
  screen: "frame",
  element: "wire",
  resource: "frame",
  endpoint: "wire",
  table: "frame",
  job: "frame",
  participant: "rectangle",
};

/**
 * The exact text drawn for a node: its label wrapped to `MAX_TEXT_WIDTH`. Citations are not
 * drawn; the viewer's Sources panel lists them. Layout measures this string and renderers draw
 * it unchanged.
 */
export function nodeText(node: Pick<BoardNode, "label">): string {
  return wrapText(node.label, MAX_TEXT_WIDTH, FONT_SIZE);
}

export function edgeLabelText(label: string): string {
  return wrapText(label, MAX_EDGE_LABEL_WIDTH, SMALL_FONT_SIZE);
}

const MIN_WIDTH = 120;
const MIN_HEIGHT = 56;
const RECT_PADDING_X = 20;
const RECT_PADDING_Y = 14;

/** Outer size of a shape whose bound text has size `text`, following Excalidraw's container rules. */
export function shapeSize(shape: NodeShape, text: TextSize): TextSize {
  const innerW = text.width + 2 * BOUND_TEXT_PADDING;
  const innerH = text.height + 2 * BOUND_TEXT_PADDING;
  switch (shape) {
    case "rectangle":
      return {
        width: Math.max(MIN_WIDTH, Math.ceil(text.width + 2 * RECT_PADDING_X)),
        height: Math.max(MIN_HEIGHT, Math.ceil(text.height + 2 * RECT_PADDING_Y)),
      };
    case "ellipse":
      return {
        width: Math.max(MIN_WIDTH, Math.ceil(innerW * Math.SQRT2) + 8),
        height: Math.max(MIN_HEIGHT, Math.ceil(innerH * Math.SQRT2) + 8),
      };
    case "diamond":
      return {
        width: Math.max(MIN_WIDTH, Math.ceil(innerW * 2) + 8),
        height: Math.max(MIN_HEIGHT, Math.ceil(innerH * 2) + 8),
      };
    case "text":
    case "frame":
    case "wire":
    case "chip":
      // Screens, elements and chips are sized by the wireframe layout, not around their text.
      return { width: text.width, height: text.height };
  }
}

export { measureText };
