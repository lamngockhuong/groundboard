import { isReferenceElement } from "./references.ts";

/**
 * Parts of a rendered board the reader can hide to see the rest better, each named by
 * `layer.<id>` in the messages. Reference images have their own Design button and are never
 * in a layer here.
 */
export const LAYERS = [
  { id: "arrows" },
  { id: "refs" },
  { id: "marks" },
  { id: "notes" },
  // Marks drawn over the canvas, not scene elements: `layerOf` never returns it.
  { id: "flowHints" },
] as const;

export type LayerId = (typeof LAYERS)[number]["id"];

const LAYER_IDS: ReadonlySet<string> = new Set(LAYERS.map((l) => l.id));

export const isLayerId = (value: string): value is LayerId => LAYER_IDS.has(value);

/** The notes the renderer writes under the board's title. */
const NOTE_IDS: ReadonlySet<string> = new Set(["title-figma", "title-grounding"]);

/**
 * The legend row of reference images: shown only when both the design and the notes are.
 * Scenes rendered before element ids were `/`-separated name it `refimg-legend-…`.
 */
const isReferenceLegend = (id: string) =>
  /^refimg\/legend-(swatch|label)\/[^/]+$/.test(id) || id.startsWith("refimg-legend-");

/** Marks the renderer draws on a node, as parts of the node's own element id. */
const MARK_PARTS = ["action", "unresolved", "spec"];

interface ElementLike {
  id?: unknown;
  frameId?: unknown;
  isDeleted?: boolean;
  version?: number;
  customData?: unknown;
}

function nodeIdOf(element: ElementLike): string | null {
  const data = (element.customData as { groundboard?: { nodeId?: unknown } } | null | undefined)
    ?.groundboard;
  return typeof data?.nodeId === "string" ? data.nodeId : null;
}

/** The layer an element of a rendered board belongs to; null for the board itself. */
export function layerOf(element: unknown): LayerId | null {
  if (typeof element !== "object" || element === null || isReferenceElement(element)) return null;
  const el = element as ElementLike;
  if (typeof el.id !== "string") return null;
  const id = el.id;
  // `kind/…` ids, and the `kind-…` ids of scenes rendered before them.
  if (/^ref-(tag|line)[/-]/.test(id)) return "refs";
  if (/^edge(-label)?[/-]/.test(id)) return "arrows";
  if (id === "legend" || el.frameId === "legend") return "notes";
  // Only the notes under the title; the question and the sources-checked status stay.
  if (NOTE_IDS.has(id)) return "notes";
  // A mark carries its node's data and is a part of the node's element: `node/<id>/action`
  // (`node-<id>-action` in older scenes). The node's own element is exactly `node/<id>`.
  const nodeId = nodeIdOf(el);
  if (
    nodeId !== null &&
    MARK_PARTS.some((part) => id === `node/${nodeId}/${part}` || id === `node-${nodeId}-${part}`)
  )
    return "marks";
  return null;
}

/** The layers a scene has elements in, in `LAYERS` order. */
export function presentLayers(elements: readonly unknown[]): LayerId[] {
  const found = new Set(elements.map(layerOf));
  return LAYERS.map((l) => l.id).filter((id) => found.has(id));
}

/**
 * The elements with every element of a hidden layer marked deleted (which Excalidraw neither
 * draws nor exports) and every element of a shown layer back. Elements already in that state,
 * and elements in no layer, are returned as they are. The legend row of reference images
 * follows both the notes layer and `designShown`, the state of the Design button.
 */
export function withLayersHidden<T>(
  elements: readonly T[],
  hidden: ReadonlySet<LayerId>,
  designShown = true,
): T[] {
  return elements.map((element) => {
    const el = element as T & ElementLike;
    const layer = layerOf(element);
    const referenceLegend = typeof el.id === "string" && isReferenceLegend(el.id);
    if (layer === null && !referenceLegend) return element;
    const hide = referenceLegend
      ? hidden.has("notes") || !designShown
      : hidden.has(layer as LayerId);
    if ((el.isDeleted === true) === hide) return element;
    return { ...el, isDeleted: hide, version: (el.version ?? 1) + 1 };
  });
}
