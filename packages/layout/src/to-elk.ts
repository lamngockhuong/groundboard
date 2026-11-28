import { type Board, isCompactScreen, screenFamilies } from "@groundboard/schema";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { cardRows, isRowTagEdge, layoutCard } from "./card.ts";
import { type FrameMarkers, layoutRefMarkers, localRouteRoom } from "./ref-markers.ts";
import { type FrameReference, layoutReferences, type ReferenceSize } from "./references.ts";
import { type FamilyLayout, layoutFamily } from "./screen-states.ts";
import {
  edgeLabelText,
  FONT_SIZE,
  measureText,
  NODE_SHAPES,
  nodeText,
  SMALL_FONT_SIZE,
  shapeSize,
} from "./text.ts";
import type { Direction, NodeShape } from "./types.ts";
import {
  childrenByParent,
  FRAME_TITLE_HEIGHT,
  layoutScreen,
  type ScreenLayout,
} from "./wireframe.ts";

export const ROOT_ID = "root";
export const groupKey = (id: string) => `g:${id}`;
export const nodeKey = (id: string) => `n:${id}`;
export const edgeKey = (id: string) => `e:${id}`;
/** The ELK node of a screen with states; `@` keeps it apart from board ids. */
export const familyKey = (rootId: string) => `n:@states:${rootId}`;
export const portKey = (rootId: string, edgeId: string) => `p:${rootId}:${edgeId}`;

/** Chip ids start with a character board ids may not contain, so they never collide. */
export const CHIP_PREFIX = "@ref:";
export const chipId = (ref: string) => `${CHIP_PREFIX}${ref}`;

const CHIP_PAD_X = 12;
const CHIP_PAD_Y = 8;

/** Per-node data that layout computes before ELK runs and carries into the result. */
export interface NodeMeasure {
  shape: NodeShape;
  text: string;
  textWidth: number;
  textHeight: number;
}

export interface ElkInput {
  graph: ElkNode;
  /** Every node that ELK places (not elements), and chips, by id. */
  measures: Map<string, NodeMeasure>;
  edgeLabels: Map<string, string>;
  /** Wireframe of each screen, relative to the frame's top-left corner. */
  screens: Map<string, ScreenLayout>;
  /** Screen that contains each element. */
  screenOf: Map<string, string>;
  /** Chips in first-use order: chip id → ref. */
  chips: Map<string, string>;
  /** Tags and list of each frame with `toRef` edges drawn as markers, by screen id. */
  markers: Map<string, FrameMarkers>;
  /** Edges drawn as a marker rather than an arrow: edge id → screen id of its frame. */
  markerEdges: Map<string, string>;
  /** Edges whose two ends sit in one screen; layout routes these itself, outside ELK. */
  localEdges: Set<string>;
  /** Screens with states, by root id, each laid out as one ELK node. */
  families: Map<string, FamilyLayout>;
  /** The family root of each frame that belongs to a family. */
  familyOf: Map<string, string>;
  /** Edges between two frames of one family, routed by the family layout. */
  familyEdges: Set<string>;
  /** Reference images beside frames, by screen id, relative to the frame's body. */
  references: Map<string, FrameReference>;
  /** Edges drawn as a tag in an endpoint's row (see `isRowTagEdge`). */
  rowTagEdges: Set<string>;
}

/** Group padding leaves room at the top for the group's label. */
const GROUP_PADDING = "[top=44,left=20,bottom=20,right=20]";

/** Above this many ELK nodes (elements excluded), crossing minimisation runs fewer passes so layout stays fast. */
const LARGE_BOARD_NODES = 150;

function rootOptions(direction: Direction, nodeCount: number): Record<string, string> {
  return {
    "elk.layered.thoroughness": nodeCount > LARGE_BOARD_NODES ? "1" : "7",
    "elk.algorithm": "layered",
    "elk.direction": direction === "down" ? "DOWN" : "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.randomSeed": "1",
    "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    "elk.spacing.nodeNode": "40",
    "elk.spacing.edgeNode": "20",
    "elk.spacing.edgeEdge": "12",
    "elk.spacing.edgeLabel": "4",
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.edgeLabels.placement": "CENTER",
  };
}

/**
 * Builds the ELK graph: groups become compound nodes nested by `parentId`, nodes become
 * children sized from their measured text, and every edge is attached to the lowest common
 * ancestor of its two nodes.
 */
export function toElk(
  board: Board,
  direction: Direction,
  referenceSizes: Readonly<Record<string, ReferenceSize>> = {},
): ElkInput {
  const measures = new Map<string, NodeMeasure>();
  const edgeLabels = new Map<string, string>();
  const containers = new Map<string, ElkNode>();
  const screens = new Map<string, ScreenLayout>();
  const screenOf = new Map<string, string>();
  const chips = new Map<string, string>();
  const localEdges = new Set<string>();
  const families = new Map<string, FamilyLayout>();
  const familyOf = new Map<string, string>();
  const familyEdges = new Set<string>();
  const stateFamilies = screenFamilies(board);
  for (const [rootId, states] of stateFamilies) {
    familyOf.set(rootId, rootId);
    for (const state of states) familyOf.set(state, rootId);
  }

  // Each element belongs to the screen at the top of its parentId chain (validated acyclic).
  const parentOf = new Map(board.nodes.map((n) => [n.id, n.parentId]));
  const kindOf = new Map(board.nodes.map((n) => [n.id, n.kind]));
  for (const node of board.nodes) {
    if (node.kind !== "element") continue;
    let current: string | undefined = node.parentId;
    while (current !== undefined && kindOf.get(current) === "element")
      current = parentOf.get(current);
    if (current !== undefined) screenOf.set(node.id, current);
  }

  // Screens first: their wireframes decide where the tags of `toRef` edges go, and how much room
  // each frame's list of targets needs beside it.
  const children = childrenByParent(board);
  // A screen with no elements and no states is a plain labelled box, not a frame.
  for (const node of board.nodes) {
    if (node.kind === "screen" && !isCompactScreen(board, node)) {
      screens.set(node.id, layoutScreen(node, children));
    }
  }
  // Cards (an API resource and its endpoints) are laid out like a wireframe: one fixed-size
  // node whose rows the edges attach to.
  for (const [cardId, rows] of cardRows(board)) {
    screens.set(cardId, layoutCard(rows));
    for (const row of rows) screenOf.set(row.id, cardId);
  }
  const markers = layoutRefMarkers(board, screens, screenOf);
  // A reference image goes right of the list; the room it takes is added to the list's.
  const references = layoutReferences(
    referenceSizes,
    screens,
    markers,
    localRouteRoom(board, screenOf),
  );
  const markerEdges = new Map<string, string>();
  for (const [screenId, frame] of markers) {
    for (const marker of frame.markers) markerEdges.set(marker.edgeId, screenId);
  }
  // A read, write or enqueue out of an endpoint is a tag in its row: no chip, no arrow.
  const rowTagEdges = new Set(board.edges.filter((e) => isRowTagEdge(e, kindOf)).map((e) => e.id));
  for (const edge of board.edges) {
    if (edge.toRef === undefined || markerEdges.has(edge.id) || rowTagEdges.has(edge.id)) continue;
    if (!chips.has(chipId(edge.toRef))) chips.set(chipId(edge.toRef), edge.toRef);
  }

  const elkNodeCount =
    board.nodes.filter((n) => !screenOf.has(n.id) && !familyOf.has(n.id)).length +
    stateFamilies.size +
    chips.size;
  const root: ElkNode = {
    id: ROOT_ID,
    layoutOptions: rootOptions(direction, elkNodeCount),
    children: [],
    edges: [],
  };
  containers.set(ROOT_ID, root);

  // Groups, parents before children (parentId chains are acyclic and at most 4 deep).
  const groupParent = new Map(board.groups.map((g) => [g.id, g.parentId]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let current: string | undefined = id;
    while (current !== undefined) {
      depth += 1;
      current = groupParent.get(current);
    }
    return depth;
  };
  const orderedGroups = [...board.groups].sort((a, b) => depthOf(a.id) - depthOf(b.id));
  for (const group of orderedGroups) {
    const node: ElkNode = {
      id: groupKey(group.id),
      layoutOptions: { "elk.padding": GROUP_PADDING },
      children: [],
      edges: [],
    };
    containers.set(group.id, node);
    const parent = containers.get(group.parentId ?? ROOT_ID) as ElkNode;
    parent.children?.push(node);
  }

  for (const node of board.nodes) {
    if (screenOf.has(node.id)) continue;
    let width: number;
    let height: number;
    if (screens.has(node.id)) {
      // A screen or a card is a fixed-size leaf: its wireframe or rows are stacked here.
      const screen = screens.get(node.id) as ScreenLayout;
      measures.set(node.id, { shape: "frame", text: "", textWidth: 0, textHeight: 0 });
      width = screen.width;
      height = screen.height + FRAME_TITLE_HEIGHT;
      if (familyOf.has(node.id)) continue; // placed with its family below
    } else {
      const shape = node.kind === "screen" ? "rectangle" : NODE_SHAPES[node.kind];
      const text = nodeText(node);
      const textSize = measureText(text, FONT_SIZE);
      const size = shapeSize(shape, textSize);
      measures.set(node.id, {
        shape,
        text,
        textWidth: textSize.width,
        textHeight: textSize.height,
      });
      width = size.width;
      height = size.height;
    }
    const parent = containers.get(node.groupId ?? ROOT_ID) as ElkNode;
    const child: ElkNode = { id: nodeKey(node.id), width, height };
    // The list of a frame's markers sits in a margin: ELK keeps other nodes out of it, but
    // edges still end on the frame itself.
    const list = screens.has(node.id) ? markers.get(node.id) : undefined;
    if (list !== undefined) {
      const bottom = Math.max(0, list.bottom - (screens.get(node.id) as ScreenLayout).height);
      child.layoutOptions = {
        "elk.margins": `[top=0,left=0,bottom=${bottom},right=${list.width}]`,
      };
    }
    parent.children?.push(child);
  }

  // Each screen with states: its frames laid out together, one ELK node with a port for every
  // edge that leaves or enters it.
  const frameOf = new Map<string, string>(screenOf);
  for (const node of board.nodes) if (screens.has(node.id)) frameOf.set(node.id, node.id);
  for (const [rootId, states] of stateFamilies) {
    const family = layoutFamily(board, rootId, states, screens, frameOf, markers);
    families.set(rootId, family);
    for (const edgeId of family.edges.keys()) familyEdges.add(edgeId);
    root.children?.push({
      id: familyKey(rootId),
      width: family.width,
      height: family.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [...family.ports.values()].map((port) => ({
        id: portKey(rootId, port.edgeId),
        x: port.x,
        y: port.y,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": port.side === "east" ? "EAST" : "WEST" },
      })),
    });
  }

  for (const [id, ref] of chips) {
    const text = `→ ${ref}`;
    const size = measureText(text, SMALL_FONT_SIZE);
    measures.set(id, { shape: "chip", text, textWidth: size.width, textHeight: size.height });
    root.children?.push({
      id: nodeKey(id),
      width: Math.ceil(size.width + 2 * CHIP_PAD_X),
      height: Math.ceil(size.height + 2 * CHIP_PAD_Y),
    });
  }

  // Ancestor chain of a placed node, nearest first, ending with the root.
  const nodeGroup = new Map(board.nodes.map((n) => [n.id, n.groupId]));
  const chain = (nodeId: string): string[] => {
    const out: string[] = [];
    let current = nodeGroup.get(nodeId);
    while (current !== undefined) {
      out.push(current);
      current = groupParent.get(current);
    }
    out.push(ROOT_ID);
    return out;
  };
  /** The node ELK places for an edge end: an element's screen, or the node itself. */
  const placed = (nodeId: string) => screenOf.get(nodeId) ?? nodeId;
  /** The family root of an edge end, if its frame belongs to a family. */
  const familyAt = (nodeId: string) => familyOf.get(placed(nodeId));

  for (const edge of board.edges) {
    if (markerEdges.has(edge.id) || rowTagEdges.has(edge.id)) continue;
    const from = placed(edge.from);
    const to = edge.toRef !== undefined ? chipId(edge.toRef) : placed(edge.to as string);
    // A foreign key without a label names its columns and how many rows it relates.
    const label = edge.label ?? referenceLabel(edge);
    if (label) {
      const text = edgeLabelText(label);
      edgeLabels.set(edge.id, text);
    }
    const touchesElement =
      screenOf.has(edge.from) || (edge.to !== undefined && screenOf.has(edge.to));
    if (from === to && touchesElement) {
      localEdges.add(edge.id);
      continue;
    }
    if (familyEdges.has(edge.id)) continue;
    const fromFamily = familyAt(edge.from);
    const toFamily = edge.toRef === undefined ? familyAt(edge.to as string) : undefined;
    // A family sits at the root: frames take no groupId.
    const fromChain = fromFamily === undefined ? chain(from) : [ROOT_ID];
    const toChain = new Set(toFamily === undefined ? chain(to) : [ROOT_ID]);
    const lca = fromChain.find((c) => toChain.has(c)) ?? ROOT_ID;
    const elkEdge: ElkExtendedEdge = {
      id: edgeKey(edge.id),
      sources: [fromFamily === undefined ? nodeKey(from) : portKey(fromFamily, edge.id)],
      targets: [toFamily === undefined ? nodeKey(to) : portKey(toFamily, edge.id)],
    };
    const text = edgeLabels.get(edge.id);
    if (text !== undefined) {
      const size = measureText(text, SMALL_FONT_SIZE);
      elkEdge.labels = [{ id: `l:${edge.id}`, text, width: size.width, height: size.height }];
    }
    containers.get(lca)?.edges?.push(elkEdge);
  }

  return {
    graph: root,
    measures,
    edgeLabels,
    screens,
    screenOf,
    chips,
    markers,
    markerEdges,
    localEdges,
    families,
    familyOf,
    familyEdges,
    references,
    rowTagEdges,
  };
}

const CARDINALITY_MARKS: Record<string, string> = {
  "one-to-one": "1:1",
  "one-to-many": "1:N",
  "many-to-one": "N:1",
  "many-to-many": "N:N",
};

/** The label a `references` edge gets when it has none: its columns and its cardinality. */
export function referenceLabel(edge: Board["edges"][number]): string | undefined {
  if (edge.kind !== "references") return undefined;
  const columns = [edge.fromColumn, edge.toColumn].filter(Boolean).join(" → ");
  const mark = edge.cardinality ? CARDINALITY_MARKS[edge.cardinality] : undefined;
  const text = [columns, mark].filter(Boolean).join("  ");
  return text === "" ? undefined : text;
}
