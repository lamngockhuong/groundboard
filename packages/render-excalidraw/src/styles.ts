import type { EdgeKind, ElementRole, NodeKind } from "@groundboard/schema";

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Arrowhead = "arrow" | "bar" | "dot" | "triangle" | null;

export interface NodeStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  textColor: string;
  opacity: number;
}

export const INK = "#1e1e1e";
/**
 * Grey strokes and borders: rejected options, `relates` edges, group and container outlines.
 * At least 3:1 on every surface a board draws them on (group tints included), in both themes.
 */
export const MUTED = "#7d848b";
/** Grey text: rejected options, frame-like labels, wireframe placeholders; at least 4.5:1. */
export const MUTED_TEXT = "#646a70";
export const ACCENT = "#e03131";
/** Warnings in text: sources not checked, a changed design; at least 4.5:1. */
export const WARNING_TEXT = "#c44b0a";
/** "Sources checked" in the title; at least 4.5:1. */
export const CHECKED_TEXT = "#28863a";

export const NODE_STYLES: Record<NodeKind, NodeStyle> = {
  step: {
    strokeColor: INK,
    backgroundColor: "#e7f5ff",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  fact: {
    strokeColor: INK,
    backgroundColor: "#ebfbee",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  cause: {
    strokeColor: ACCENT,
    backgroundColor: "#fff5f5",
    strokeStyle: "solid",
    strokeWidth: 2,
    textColor: INK,
    opacity: 100,
  },
  rejected: {
    strokeColor: MUTED,
    backgroundColor: "#f1f3f5",
    strokeStyle: "dashed",
    strokeWidth: 1,
    textColor: MUTED_TEXT,
    opacity: 100,
  },
  question: {
    strokeColor: "#bd6e00",
    backgroundColor: "#fff3bf",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  state: {
    strokeColor: "#1971c2",
    backgroundColor: "#d0ebff",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  decision: {
    strokeColor: "#9c36b5",
    backgroundColor: "#f3d9fa",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  note: {
    strokeColor: "#495057",
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: "#495057",
    opacity: 100,
  },
  // Screens are frames and elements are drawn by role (`ROLE_STYLES`); these entries only
  // keep the record total.
  screen: {
    strokeColor: INK,
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: MUTED_TEXT,
    opacity: 100,
  },
  element: {
    strokeColor: INK,
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  // A resource is a frame and its endpoints its rows.
  resource: {
    strokeColor: INK,
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: MUTED_TEXT,
    opacity: 100,
  },
  endpoint: {
    strokeColor: "#0c8599",
    backgroundColor: "#e3fafc",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
  // A table and a job are frames; their rows use `COLUMN_STYLE`.
  job: {
    strokeColor: INK,
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: MUTED_TEXT,
    opacity: 100,
  },
  table: {
    strokeColor: INK,
    backgroundColor: "transparent",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: MUTED_TEXT,
    opacity: 100,
  },
  // A participant of a sequence board; `PARTICIPANT_STYLES` tells its categories apart.
  participant: {
    strokeColor: INK,
    backgroundColor: "#edf2ff",
    strokeStyle: "solid",
    strokeWidth: 1,
    textColor: INK,
    opacity: 100,
  },
};

/** A column's row in a table's card. */
export const COLUMN_STYLE: NodeStyle = {
  strokeColor: "#ced4da",
  backgroundColor: "#f8f9fa",
  strokeStyle: "solid",
  strokeWidth: 1,
  textColor: INK,
  opacity: 100,
};

/** Flow kinds the legend lists for any board that has a node of a flow kind. */
export const FLOW_KINDS = [
  "step",
  "state",
  "decision",
  "cause",
  "rejected",
  "fact",
  "question",
  "note",
] as const satisfies readonly NodeKind[];

export const LINK_COLOR = "#1971c2";
/** Strokes of open questions and unresolved handlers; at least 3:1. */
export const UNRESOLVED_COLOR = "#bd6e00";
/** The "?" of an unresolved handler; at least 4.5:1. */
export const UNRESOLVED_TEXT = "#9c5b00";
/** The "spec" tag on claims backed only by a specification (documents, Figma, mockups, links). */
export const SPEC_COLOR = "#1864ab";
/** Stroke of a claim backed only by a specification; no other part of a scene draws dotted. */
export const SPEC_STROKE = "dotted" as const;

/** Monochrome low-fidelity wireframe styles by element role. */
export const ROLE_STYLES: Record<
  ElementRole,
  { strokeColor: string; backgroundColor: string; textColor: string; rounded: boolean }
> = {
  container: {
    strokeColor: MUTED,
    backgroundColor: "transparent",
    textColor: MUTED_TEXT,
    rounded: false,
  },
  text: {
    strokeColor: "transparent",
    backgroundColor: "transparent",
    textColor: INK,
    rounded: false,
  },
  link: {
    strokeColor: "transparent",
    backgroundColor: "transparent",
    textColor: LINK_COLOR,
    rounded: false,
  },
  button: { strokeColor: INK, backgroundColor: "#e9ecef", textColor: INK, rounded: true },
  input: { strokeColor: INK, backgroundColor: "#ffffff", textColor: MUTED_TEXT, rounded: false },
  checkbox: {
    strokeColor: "transparent",
    backgroundColor: "transparent",
    textColor: INK,
    rounded: false,
  },
  image: { strokeColor: MUTED, backgroundColor: "#f8f9fa", textColor: MUTED_TEXT, rounded: false },
  icon: {
    strokeColor: "transparent",
    backgroundColor: "transparent",
    textColor: INK,
    rounded: false,
  },
  bar: { strokeColor: "#dee2e6", backgroundColor: "#f1f3f5", textColor: INK, rounded: false },
};

export const KIND_LABELS: Record<NodeKind, string> = {
  step: "step",
  state: "state",
  decision: "decision",
  cause: "cause",
  rejected: "rejected option",
  fact: "fact",
  question: "open question",
  note: "note",
  screen: "screen",
  element: "screen element",
  resource: "API resource",
  endpoint: "API endpoint",
  table: "table",
  job: "background job",
  participant: "participant",
};

export interface EdgeStyle {
  strokeColor: string;
  strokeStyle: StrokeStyle;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
}

export const EDGE_STYLES: Record<EdgeKind, EdgeStyle> = {
  flow: { strokeColor: INK, strokeStyle: "solid", startArrowhead: null, endArrowhead: "arrow" },
  transition: {
    strokeColor: "#1971c2",
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  causes: {
    strokeColor: ACCENT,
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  blocks: { strokeColor: ACCENT, strokeStyle: "dashed", startArrowhead: null, endArrowhead: "bar" },
  relates: { strokeColor: MUTED, strokeStyle: "dashed", startArrowhead: null, endArrowhead: null },
  navigates: {
    strokeColor: ACCENT,
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  calls: {
    strokeColor: "#0c8599",
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  references: {
    strokeColor: "#495057",
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "triangle",
  },
  reads: {
    strokeColor: "#2f9e44",
    strokeStyle: "dashed",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  writes: {
    strokeColor: "#2f9e44",
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  enqueues: {
    strokeColor: "#e8590c",
    strokeStyle: "dashed",
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  // A call that waits; `MESSAGE_STYLES` tells replies and async messages apart.
  message: {
    strokeColor: INK,
    strokeStyle: "solid",
    startArrowhead: null,
    endArrowhead: "triangle",
  },
};

/** Tint of nested group rectangles, by nesting depth (2 = first nested level). */
export const GROUP_TINTS = ["#f8f9fa", "#f1f3f5", "#e9ecef", "#dee2e6"];
