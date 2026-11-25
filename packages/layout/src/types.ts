import type { EdgeKind, ElementRole, NodeKind, OverlayNote } from "@groundboard/schema";

/** A note of a layout overlay at the position it is drawn at: its anchor's, or its own. */
export interface PlacedNote extends OverlayNote {
  x: number;
  y: number;
}

export type Direction = "right" | "down";

/** The outline a renderer draws for a node. Layout sizes nodes so their text fits this outline. */
export type NodeShape =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  /** a screen, drawn as an Excalidraw frame */
  | "frame"
  /** an element of a screen wireframe, drawn by role */
  | "wire"
  /** a reference to a screen on another board, the target of a `toRef` edge */
  | "chip";

export type Point = readonly [x: number, y: number];

export interface LaidOutNode {
  /** Board node id; a chip's id is `CHIP_PREFIX` + its ref, which no board id can be. */
  id: string;
  /**
   * `ref` for a chip; `column` for the row of a table's column and `row` for a row of a job's
   * card, neither a board node.
   */
  kind: NodeKind | "ref" | "column" | "row";
  shape: NodeShape;
  groupId?: string;
  /** element: the screen or element that contains it */
  parentId?: string;
  /** element: its role */
  role?: ElementRole;
  /** element: the screen whose frame contains it */
  screenId?: string;
  /** screen, element (defined) or chip (referenced) */
  ref?: string;
  /** Absolute position and size of the shape. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Exact text to draw inside the shape, already wrapped; equals `nodeText()` of the node. */
  text: string;
  fontSize: number;
  textWidth: number;
  textHeight: number;
  /** Absolute top-left of the text, for wire shapes, which place their own text. Other shapes centre bound text. */
  textX?: number;
  textY?: number;
}

export interface LaidOutGroup {
  id: string;
  label: string;
  parentId?: string;
  /** 1 for a top-level group. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdgeLabel {
  text: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box of text at an absolute position, its text already wrapped. */
export interface LaidOutText {
  text: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How a screen board draws a `toRef` edge out of a frame: a numbered tag on its source and a
 * line naming the target in a list beside the frame, instead of an arrow to a chip.
 */
export interface LaidOutRefMarker {
  /** 1-based, in the visual order of the sources within the frame. */
  number: number;
  /** The frame whose list holds the line. */
  screenId: string;
  /** The tag's outline; its text is the number, centred in it. */
  tag: LaidOutText;
  /** The list line: the number, the edge label if any, and the target ref. */
  line: LaidOutText;
}

export interface LaidOutEdge {
  id: string;
  from: string;
  /**
   * A laid-out node id; for a `toRef` edge, the chip's id. An edge drawn as a `marker` has no
   * chip, so its `to` names no laid-out node.
   */
  to: string;
  /** Set when the edge points at a screen on another board. */
  toRef?: string;
  kind: EdgeKind;
  /** Absolute route: start point, bend points, end point. Empty for an edge with a `marker`. */
  points: Point[];
  /** Set instead of an arrow route and a label: the edge's tag and list line. */
  marker?: LaidOutRefMarker;
  label?: LaidOutEdgeLabel;
}

/** Where a frame's reference image goes, with its dashed border and caption. */
export interface LaidOutReference {
  screenId: string;
  image: { x: number; y: number; width: number; height: number };
  border: { x: number; y: number; width: number; height: number };
  caption: LaidOutText;
}

/** Everything a renderer needs; renderers never see the layout engine. */
export interface LaidOutBoard {
  direction: Direction;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  groups: LaidOutGroup[];
  edges: LaidOutEdge[];
  /** Only when a reference was asked for a frame with a wireframe. */
  references?: LaidOutReference[];
}
