// Minimal typed builders for Excalidraw elements. Excalidraw's `restore()` fills every base
// field left out here when a scene is opened.

import type { Arrowhead, StrokeStyle } from "./styles.ts";

export const EXCALIFONT = 5;
export const LINE_HEIGHT = 1.25;

export interface BoundElementRef {
  type: "text" | "arrow";
  id: string;
}

/** Superset of the 0.18.1 binding (`focus`, `gap`) and the newer one (`fixedPoint`, `mode`). */
export interface PointBinding {
  elementId: string;
  focus: number;
  gap: number;
  fixedPoint: [number, number];
  mode: "orbit";
}

interface Base {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid" | "hachure";
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: { type: number } | null;
  seed: number;
  version: 1;
  versionNonce: number;
  isDeleted: false;
  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElementRef[] | null;
  link: string | null;
  locked: boolean;
  customData?: Record<string, unknown>;
}

export interface ShapeElement extends Base {
  type: "rectangle" | "ellipse" | "diamond";
}

export interface TextElement extends Base {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle";
  lineHeight: number;
  containerId: string | null;
  autoResize: true;
}

export interface ArrowElement extends Base {
  type: "arrow";
  points: [number, number][];
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  elbowed: false;
}

export interface LineElement extends Base {
  type: "line";
  points: [number, number][];
  startBinding: null;
  endBinding: null;
  startArrowhead: null;
  endArrowhead: null;
}

/** A freehand stroke through `points`, given relative to (x, y). */
export interface FreedrawElement extends Base {
  type: "freedraw";
  points: [number, number][];
  pressures: number[];
  simulatePressure: true;
}

export interface FrameElement extends Base {
  type: "frame";
  name: string;
}

/** A picture whose bytes travel in the scene's `files` under `fileId`. */
export interface ImageElement extends Base {
  type: "image";
  fileId: string;
  status: "saved";
  scale: [1, 1];
  crop: null;
}

export type ExcalidrawElement =
  | ShapeElement
  | TextElement
  | ArrowElement
  | LineElement
  | FreedrawElement
  | FrameElement
  | ImageElement;

/** An image's bytes, as a data URL. */
export interface BinaryFile {
  id: string;
  mimeType: "image/png";
  dataURL: string;
  created: number;
}

export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: null };
  files: Record<string, BinaryFile>;
}

/** FNV-1a: a stable 31-bit seed per element id, so output is deterministic. */
export function seedFor(id: string, salt = 0): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1 || 1;
}

export type Common = Pick<Base, "id" | "x" | "y" | "width" | "height"> & Partial<Base>;

function base(props: Common): Base {
  return {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: seedFor(props.id),
    version: 1,
    versionNonce: seedFor(props.id, 7),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    ...props,
  };
}

export function shape(type: ShapeElement["type"], props: Common): ShapeElement {
  return { type, ...base(props) };
}

export function text(
  props: Common & {
    text: string;
    fontSize: number;
    textAlign?: TextElement["textAlign"];
    verticalAlign?: TextElement["verticalAlign"];
    containerId?: string | null;
  },
): TextElement {
  const { text: content, fontSize, textAlign, verticalAlign, containerId, ...rest } = props;
  return {
    type: "text",
    ...base(rest),
    text: content,
    originalText: content,
    fontSize,
    fontFamily: EXCALIFONT,
    textAlign: textAlign ?? "center",
    verticalAlign: verticalAlign ?? "middle",
    lineHeight: LINE_HEIGHT,
    containerId: containerId ?? null,
    autoResize: true,
  };
}

export function arrow(
  props: Common & {
    points: [number, number][];
    startBinding: PointBinding | null;
    endBinding: PointBinding | null;
    startArrowhead: Arrowhead;
    endArrowhead: Arrowhead;
  },
): ArrowElement {
  const { points, startBinding, endBinding, startArrowhead, endArrowhead, ...rest } = props;
  return {
    type: "arrow",
    ...base(rest),
    points,
    startBinding,
    endBinding,
    startArrowhead,
    endArrowhead,
    elbowed: false,
  };
}

/** A polyline through `points`, given relative to (x, y). */
export function line(props: Common & { points: [number, number][] }): LineElement {
  const { points, ...rest } = props;
  return {
    type: "line",
    ...base(rest),
    points,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  };
}

export function image(props: Common & { fileId: string }): ImageElement {
  const { fileId, ...rest } = props;
  return {
    type: "image",
    ...base({ strokeColor: "transparent", ...rest }),
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
}

export function frame(props: Common & { name: string }): FrameElement {
  const { name, ...rest } = props;
  return { type: "frame", ...base(rest), name };
}

export function freedraw(props: Common & { points: [number, number][] }): FreedrawElement {
  const { points, ...rest } = props;
  return { type: "freedraw", ...base(rest), points, pressures: [], simulatePressure: true };
}
