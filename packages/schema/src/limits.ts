/** Size limits that keep layout and rendering bounded for any input, including untrusted HTTP input. */
export const LIMITS = {
  nodes: 500,
  edges: 1000,
  groups: 50,
  sources: 1000,
  sourceIdsPerNode: 50,
  /** label, detail, quote */
  longText: 2000,
  /** title, question, path, group label */
  shortText: 300,
  id: 64,
  groupDepth: 4,
  /** element nesting under a screen */
  elementDepth: 8,
  /** tags on a board, and the length of one */
  tags: 10,
  tag: 40,
  /** layouts one screen is drawn in */
  layoutsPerScreen: 5,
  /** columns of one table */
  columns: 200,
  /** notes in a layout overlay, and the overlay file's size in bytes */
  overlayNotes: 500,
  overlayBytes: 1024 * 1024,
  /** points of one drawn note (a line, an arrow or a freehand stroke) */
  notePoints: 5000,
} as const;

export const SCHEMA_VERSION = 1;
