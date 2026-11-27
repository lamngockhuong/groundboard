import { measureText } from "@groundboard/layout/text";
import type { LaidOutBoard, LaidOutNode, LaidOutReference } from "@groundboard/layout/types";
import {
  type Board,
  type BoardNode,
  figmaCacheName,
  figmaUrl,
  INTERACTIVE_ROLES,
} from "@groundboard/schema";
import { type BinaryFile, type ExcalidrawElement, image, shape, text } from "./elements.ts";
import { ACCENT, LINK_COLOR, MUTED, MUTED_TEXT, UNRESOLVED_COLOR, WARNING_TEXT } from "./styles.ts";

/**
 * Prefix of every element and file id a reference image adds, so a viewer can hide them. Parts
 * after the screen id are joined with `/`, which no board id contains, so ids never collide.
 * The legend row of reference images is `refimg/legend-swatch/reference` and
 * `refimg/legend-label/reference`, a shape no screen's ids take.
 */
export const REFERENCE_PREFIX = "refimg/";

/**
 * A cached image of the Figma frame a screen is drawn from, with the boxes of the layers its
 * elements cite. The renderer never reads files or calls Figma; the caller loads this.
 */
export interface ReferenceImage {
  figma: { fileKey: string; nodeId: string };
  /** `data:image/png;base64,...` */
  dataUrl: string;
  fetchedAt: string;
  /** A later look at the Figma file found it changed after the image was taken. */
  designChanged: boolean;
  /** The frame's top-left corner inside the image. */
  originX: number;
  originY: number;
  /** `[x, y, width, height]` of each cited layer, relative to the frame. */
  nodes: Readonly<Record<string, readonly [number, number, number, number]>>;
}

/** The caption under a reference image; layout measures it, the renderer draws it. */
export function referenceCaption(
  reference: Pick<ReferenceImage, "figma" | "fetchedAt" | "designChanged">,
): string {
  const parts = [
    `Figma reference (node ${reference.figma.nodeId})`,
    `fetched ${reference.fetchedAt.slice(0, 10)}`,
    "not re-checkable",
  ];
  if (reference.designChanged) parts.push("design changed since fetch");
  return parts.join(" · ");
}

const interactive = new Set<string>(INTERACTIVE_ROLES);
const round = (n: number) => Math.round(n * 100) / 100;

interface Data {
  /** The customData of an element's wireframe shape. */
  node: (node: BoardNode) => Record<string, unknown>;
  /** The customData of an edge's tag. */
  edge: (edgeId: string) => Record<string, unknown>;
}

/**
 * For each laid-out reference with a loaded image: the image, its dashed border and caption,
 * locked and grouped (`images`, drawn under the board, so an arrow that crosses an image stays
 * visible); and, over the image, a box for each element that cites a layer whose box is known,
 * with the element's handler dot and its numbered tags, carrying the same data as the element
 * and the tags in the wireframe (`overlays`, drawn over the board).
 */
export function renderReferences(
  laidOut: LaidOutBoard,
  board: Board,
  images: ReadonlyMap<string, ReferenceImage>,
  data: Data,
): {
  images: ExcalidrawElement[];
  overlays: ExcalidrawElement[];
  files: Record<string, BinaryFile>;
} {
  const imageElements: ExcalidrawElement[] = [];
  const elements: ExcalidrawElement[] = [];
  const files: Record<string, BinaryFile> = {};
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const boardNodes = new Map(board.nodes.map((n) => [n.id, n]));
  for (const reference of laidOut.references ?? []) {
    const loaded = images.get(reference.screenId);
    if (loaded === undefined) continue;
    const fileId = `${REFERENCE_PREFIX}${figmaCacheName(loaded.figma)}`;
    files[fileId] = {
      id: fileId,
      mimeType: "image/png",
      dataURL: loaded.dataUrl,
      created: Date.parse(loaded.fetchedAt) || 0,
    };
    imageElements.push(...frameImage(reference, loaded, fileId));

    // Overlays, in board order of the elements of this frame.
    const at = (dx: number, dy: number) => [
      reference.image.x + loaded.originX + dx,
      reference.image.y + loaded.originY + dy,
    ];
    for (const node of laidOut.nodes) {
      if (node.shape !== "wire" || node.screenId !== reference.screenId) continue;
      const source = boardNodes.get(node.id) as BoardNode;
      const box = source.sourceIds
        .map((id) => sources.get(id))
        .flatMap((s) =>
          s?.kind === "figma" && loaded.nodes[s.nodeId] ? [loaded.nodes[s.nodeId]] : [],
        )[0];
      if (box === undefined) continue;
      const [x, y] = at(box[0], box[1]) as [number, number];
      const overlay = { x: round(x), y: round(y), width: round(box[2]), height: round(box[3]) };
      elements.push(...elementOverlay(reference.screenId, node, source, overlay, data));
      elements.push(...tagCopies(reference.screenId, node, overlay, laidOut, data));
    }
  }
  return { images: imageElements, overlays: elements, files };
}

function frameImage(
  reference: LaidOutReference,
  loaded: ReferenceImage,
  fileId: string,
): ExcalidrawElement[] {
  const id = `${REFERENCE_PREFIX}${reference.screenId}`;
  const common = {
    groupIds: [`${id}/group`],
    locked: true,
    customData: {
      groundboard: {
        kind: "reference-image",
        screenId: reference.screenId,
        figma: { ...loaded.figma, url: figmaUrl(loaded.figma) },
        fetchedAt: loaded.fetchedAt,
        ...(loaded.designChanged ? { designChanged: true } : {}),
      },
    },
  };
  const { caption } = reference;
  return [
    shape("rectangle", {
      id: `${id}/border`,
      ...reference.border,
      strokeColor: MUTED,
      strokeStyle: "dashed",
      ...common,
    }),
    image({ id, ...reference.image, fileId, ...common }),
    text({
      id: `${id}/caption`,
      x: caption.x,
      y: caption.y,
      width: caption.width,
      height: caption.height,
      text: caption.text,
      fontSize: caption.fontSize,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: loaded.designChanged ? WARNING_TEXT : MUTED_TEXT,
      ...common,
    }),
  ];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The element's box over the image and its handler dot, as the wireframe draws them. */
function elementOverlay(
  screenId: string,
  node: LaidOutNode,
  source: BoardNode,
  box: Box,
  data: Data,
): ExcalidrawElement[] {
  const id = `${REFERENCE_PREFIX}${screenId}/node/${node.id}`;
  const customData = data.node(source);
  const groupIds = [`${id}/group`];
  const color =
    source.unresolved !== undefined
      ? UNRESOLVED_COLOR
      : interactive.has(source.role ?? "")
        ? LINK_COLOR
        : MUTED;
  const out: ExcalidrawElement[] = [
    shape("rectangle", {
      id,
      ...box,
      strokeColor: color,
      strokeStyle:
        interactive.has(source.role ?? "") || source.unresolved !== undefined ? "solid" : "dashed",
      strokeWidth: 2,
      groupIds,
      customData,
    }),
  ];
  if (source.unresolved === undefined && source.action !== undefined) {
    out.push(
      shape("ellipse", {
        id: `${id}/action`,
        x: round(box.x + box.width - 12),
        y: round(box.y + 4),
        width: 8,
        height: 8,
        strokeColor: ACCENT,
        backgroundColor: ACCENT,
        groupIds,
        customData,
      }),
    );
  }
  return out;
}

/**
 * Copies of the numbered tags on an element: each sits where it sits on the wireframe,
 * measured from the top-right corner of what the reader sees of the element (the text of a
 * text or link, the box otherwise), so the numbers match the list beside the frame.
 */
function tagCopies(
  screenId: string,
  node: LaidOutNode,
  box: Box,
  laidOut: LaidOutBoard,
  data: Data,
): ExcalidrawElement[] {
  const bare = node.role === "text" || node.role === "link";
  const anchor: Box = bare
    ? {
        x: node.textX ?? node.x,
        y: node.textY ?? node.y,
        width: node.textWidth,
        height: node.textHeight,
      }
    : node;
  const out: ExcalidrawElement[] = [];
  for (const edge of laidOut.edges) {
    if (edge.marker === undefined || edge.from !== node.id) continue;
    const { tag } = edge.marker;
    const x = round(box.x + box.width + (tag.x - (anchor.x + anchor.width)));
    const y = round(box.y + (tag.y - anchor.y));
    const id = `${REFERENCE_PREFIX}${screenId}/tag/${edge.id}`;
    const common = {
      groupIds: [`${id}/group`],
      customData: data.edge(edge.id),
      strokeColor: ACCENT,
    };
    const number = measureText(tag.text, tag.fontSize);
    out.push(
      shape("rectangle", {
        id,
        x,
        y,
        width: tag.width,
        height: tag.height,
        backgroundColor: "#ffffff",
        strokeStyle: "dashed",
        roundness: { type: 3 },
        ...common,
      }),
      text({
        id: `${id}/number`,
        x: round(x + (tag.width - number.width) / 2),
        y: round(y + (tag.height - number.height) / 2),
        width: number.width,
        height: number.height,
        text: tag.text,
        fontSize: tag.fontSize,
        ...common,
      }),
    );
  }
  return out;
}
