import { wrapText } from "@groundboard/layout/measure";
import { FONT_SIZE, measureText, SMALL_FONT_SIZE } from "@groundboard/layout/text";
import type {
  LaidOutBoard,
  LaidOutEdge,
  LaidOutGroup,
  LaidOutNode,
  LaidOutRefMarker,
  PlacedNote,
  Point,
} from "@groundboard/layout/types";
import {
  type Board,
  type BoardNode,
  type BoardSource,
  boardClaims,
  type EdgeKind,
  figmaUrl,
  findColumn,
  type Grounding,
  isCheckable,
  type LayoutOrigin,
  type NodeKind,
} from "@groundboard/schema";
import {
  type ArrowElement,
  arrow,
  type ExcalidrawElement,
  type ExcalidrawScene,
  frame,
  line,
  type PointBinding,
  shape,
  type TextElement,
  text,
} from "./elements.ts";
import { renderNotes } from "./notes.ts";
import { REFERENCE_PREFIX, type ReferenceImage, renderReferences } from "./references.ts";
import {
  ACCENT,
  COLUMN_STYLE,
  EDGE_STYLES,
  FLOW_KINDS,
  GROUP_TINTS,
  INK,
  KIND_LABELS,
  LINK_COLOR,
  MUTED,
  NODE_STYLES,
  type NodeStyle,
  ROLE_STYLES,
  SPEC_COLOR,
  SPEC_STROKE,
  UNRESOLVED_COLOR,
} from "./styles.ts";

export const SCENE_SOURCE = "https://github.com/lamngockhuong/groundboard";

/** Where the cited sources were checked; `null` or absent means they were not checked. */
export interface SourcesChecked {
  /** What the files were read from, e.g. "working tree". */
  root: string;
  /** Set only when the files read are what this commit holds, so the title can name it. */
  commit?: string;
}

export interface RenderOptions {
  sourcesChecked?: SourcesChecked | null;
  /**
   * Reference images by screen id, drawn where layout reserved them (`layoutBoard`'s
   * `references`). Without it the scene is exactly what it was before references existed.
   */
  references?: ReadonlyMap<string, ReferenceImage>;
  /** Notes of the board's layout overlay, placed by `applyOverlay`; drawn on top. */
  notes?: readonly PlacedNote[];
}

const BINDING_GAP = 4;

/*
 * Element ids are `<kind>/<board id>`, and a part drawn for the same board item adds
 * `/<part>`. Board ids never contain `/`, so no two board items or parts can share an id.
 */
export const nodeElementId = (id: string) => `node/${id}`;
export const labelElementId = (id: string) => `label/${id}`;
export const edgeElementId = (id: string) => `edge/${id}`;
export const edgeLabelElementId = (id: string) => `edge-label/${id}`;
export const groupElementId = (id: string) => `group/${id}`;
export const groupLabelElementId = (id: string) => `group-label/${id}`;
export const refTagElementId = (id: string) => `ref-tag/${id}`;
export const refLineElementId = (id: string) => `ref-line/${id}`;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Link for a source: the Figma URL built from a Figma source's parts, a link source's URL, or a
 * GitHub-style blob link for a code or document source or a committed mockup (null when the
 * board lacks `repo.url` or `repo.commit`, and for a mockup without a path).
 */
export function sourceLink(repo: Board["repo"], source: BoardSource): string | null {
  switch (source.kind) {
    case "figma":
      return figmaUrl(source);
    case "link":
      return source.url;
    case "mockup":
      return source.path === undefined ? null : blobLink(repo, source.path, "");
    case "code":
    case "doc": {
      const anchor =
        source.endLine !== undefined && source.endLine !== source.line
          ? `#L${source.line}-L${source.endLine}`
          : `#L${source.line}`;
      return blobLink(repo, source.path, anchor);
    }
    default: {
      const unknown: never = source;
      throw new Error(`unknown source kind ${JSON.stringify(unknown)}`);
    }
  }
}

function blobLink(repo: Board["repo"], filePath: string, anchor: string): string | null {
  if (!repo?.url || !repo.commit) return null;
  const base = repo.url.replace(/\/+$/, "").replace(/\.git$/, "");
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/blob/${repo.commit}/${encoded}${anchor}`;
}

export function statusLine(sourcesChecked: SourcesChecked | null | undefined): string {
  if (!sourcesChecked) return "Sources NOT checked";
  return sourcesChecked.commit
    ? `Sources checked against commit ${sourcesChecked.commit}`
    : `Sources checked against the ${sourcesChecked.root}`;
}

/**
 * Moves an arrow end that ELK placed on a node's bounding box onto the outline of an ellipse
 * or diamond, along the arrow's last (axis-aligned) segment.
 */
function clipToOutline(end: Point, previous: Point, node: LaidOutNode): Point {
  if (node.shape !== "ellipse" && node.shape !== "diamond") return end;
  const a = node.width / 2;
  const b = node.height / 2;
  const cx = node.x + a;
  const cy = node.y + b;
  const halfSpan = (offset: number, radius: number, other: number) => {
    const t = Math.abs(offset) / radius;
    if (t >= 1) return null;
    return node.shape === "diamond" ? other * (1 - t) : other * Math.sqrt(1 - t * t);
  };
  const [x, y] = end;
  if (Math.abs(previous[1] - y) < 0.5) {
    const half = halfSpan(y - cy, b, a);
    if (half === null) return end;
    return [round(x <= cx ? cx - half : cx + half), y];
  }
  if (Math.abs(previous[0] - x) < 0.5) {
    const half = halfSpan(x - cx, a, b);
    if (half === null) return end;
    return [x, round(y <= cy ? cy - half : cy + half)];
  }
  return end;
}

function binding(elementId: string, point: Point, node: LaidOutNode): PointBinding {
  // Excalidraw normalises an exact 0.5 to 0.5001 (an exact centre is ambiguous for orbit
  // bindings); emitting it already normalised means restore leaves the binding untouched.
  const clamp = (v: number) => {
    const r = Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
    return r === 0.5 ? 0.5001 : r;
  };
  return {
    elementId,
    focus: 0,
    gap: BINDING_GAP,
    fixedPoint: [
      clamp((point[0] - node.x) / (node.width || 1)),
      clamp((point[1] - node.y) / (node.height || 1)),
    ],
    mode: "orbit",
  };
}

/** Where Excalidraw centres an arrow's bound label: the middle point, or the middle segment's midpoint. */
function arrowLabelCenter(points: Point[]): Point {
  const n = points.length;
  if (n % 2 === 1) return points[(n - 1) / 2] as Point;
  const a = points[n / 2 - 1] as Point;
  const b = points[n / 2] as Point;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * A cited source as it travels in `customData`: code sources keep their original shape. A doc
 * source and a committed mockup carry their repository link when the board has `repo.url` and
 * `repo.commit`, so the viewer does not build it.
 */
function sourceData(source: BoardSource, repo: Board["repo"]): Record<string, unknown> {
  const url = source.kind === "doc" || source.kind === "mockup" ? sourceLink(repo, source) : null;
  switch (source.kind) {
    case "figma":
      return {
        id: source.id,
        kind: "figma",
        fileKey: source.fileKey,
        nodeId: source.nodeId,
        url: figmaUrl(source),
      };
    case "code":
    case "doc":
      return {
        id: source.id,
        ...(source.kind === "doc" ? { kind: "doc" } : {}),
        path: source.path,
        line: source.line,
        ...(source.endLine !== undefined ? { endLine: source.endLine } : {}),
        ...(source.quote !== undefined ? { quote: source.quote } : {}),
        ...(url !== null ? { url } : {}),
      };
    case "link":
      return {
        id: source.id,
        kind: "link",
        url: source.url,
        title: source.title,
        ...(source.quote !== undefined ? { quote: source.quote } : {}),
        ...(source.retrievedAt !== undefined ? { retrievedAt: source.retrievedAt } : {}),
      };
    case "mockup":
      return {
        id: source.id,
        kind: "mockup",
        label: source.label,
        ...(source.path !== undefined ? { path: source.path } : {}),
        ...(url !== null ? { url } : {}),
      };
    default: {
      const unknown: never = source;
      throw new Error(`unknown source kind ${JSON.stringify(unknown)}`);
    }
  }
}

/** Font size of the tag drawn on a claim backed only by a specification, or added by hand. */
const TAG_FONT_SIZE = 12;
const SPEC_TAG = "spec";
/** The tag of a claim a person added or reworded in the viewer: not checked against sources. */
export const MANUAL_TAG = "manual";

/** A small tag at (x, y), carrying the claim's data so selecting it selects the claim. */
function specTag(
  id: string,
  x: number,
  y: number,
  props: { frameId?: string | null; customData?: Record<string, unknown>; label?: string },
): TextElement {
  const label = props.label ?? SPEC_TAG;
  const size = measureText(label, TAG_FONT_SIZE);
  return text({
    id,
    x: round(x),
    y: round(y),
    width: size.width,
    height: size.height,
    text: label,
    fontSize: TAG_FONT_SIZE,
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: SPEC_COLOR,
    frameId: props.frameId ?? null,
    ...(props.customData ? { customData: props.customData } : {}),
  });
}

/** How a screen's layout origin reads in its frame name. */
const ORIGIN_LABELS: Record<LayoutOrigin, string> = {
  figma: "from Figma",
  screenshot: "from a screenshot, not re-checkable",
  mockup: "from a client mockup",
  doc: "described in a document, no layout yet",
  code: "inferred from code",
};

/** Maps a laid-out board to an `.excalidraw` scene. Imports only layout types and text helpers. */
export function renderExcalidraw(
  laidOut: LaidOutBoard,
  board: Board,
  options: RenderOptions = {},
): ExcalidrawScene {
  const groups = new Map(laidOut.groups.map((g) => [g.id, g]));
  const nodes = new Map(laidOut.nodes.map((n) => [n.id, n]));
  const boardNodes = new Map(board.nodes.map((n) => [n.id, n]));
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const boardEdges = new Map(board.edges.map((e) => [e.id, e]));
  const cite = (sourceIds: string[]) =>
    sourceIds.map((sid) => sources.get(sid)).filter((s): s is BoardSource => s !== undefined);
  const toData = (source: BoardSource) => sourceData(source, board.repo);
  // Grounding of each claim; only a value other than code travels in customData, so the
  // scenes of boards backed entirely by code do not change.
  const claims = boardClaims(board);
  const nodeGrounding = new Map<string, Grounding>();
  const edgeGrounding = new Map<string, Grounding>();
  for (const claim of claims) {
    (claim.on === "node" ? nodeGrounding : edgeGrounding).set(claim.id, claim.grounding);
  }
  const manualIds = new Set(claims.filter((c) => c.manual).map((c) => `${c.on}:${c.id}`));
  /**
   * What the viewer reads about a claim: its grounding, every time, so it never has to guess one;
   * and for a claim a person changed, that it is manual and which sources it cited before.
   */
  const groundingField = (
    on: "node" | "edge",
    id: string,
    priorSourceIds: readonly string[] | undefined,
  ) => {
    const grounding = (on === "node" ? nodeGrounding : edgeGrounding).get(id);
    if (grounding === undefined) return {};
    const manual = manualIds.has(`${on}:${id}`);
    const prior = manual ? cite([...(priorSourceIds ?? [])]) : [];
    return {
      grounding,
      ...(manual ? { manual: true } : {}),
      ...(prior.length > 0 ? { priorSources: prior.map(toData) } : {}),
    };
  };
  /** Dotted outline and a tag: backed by a specification only, or added by hand. */
  const markOf = (on: "node" | "edge", id: string): { dotted: boolean; tag?: string } => {
    if (manualIds.has(`${on}:${id}`)) return { dotted: true, tag: MANUAL_TAG };
    const spec = (on === "node" ? nodeGrounding : edgeGrounding).get(id) === "spec";
    return spec ? { dotted: true, tag: SPEC_TAG } : { dotted: false };
  };

  /** The top-level group (rendered as a frame) that contains a group. */
  const topGroup = (groupId: string): LaidOutGroup => {
    let group = groups.get(groupId) as LaidOutGroup;
    while (group.parentId !== undefined) group = groups.get(group.parentId) as LaidOutGroup;
    return group;
  };
  /** Excalidraw group ids for members of a group: nested levels only, deepest first. */
  const nestedGroupIds = (groupId: string | undefined): string[] => {
    const out: string[] = [];
    let current = groupId === undefined ? undefined : groups.get(groupId);
    while (current && current.parentId !== undefined) {
      out.push(`grp-${current.id}`);
      current = groups.get(current.parentId);
    }
    return out;
  };
  const frameIdOf = (groupId: string | undefined): string | null =>
    groupId === undefined ? null : groupElementId(topGroup(groupId).id);

  const background: ExcalidrawElement[] = [];
  const nodeElements: ExcalidrawElement[] = [];
  const edgeElements: ExcalidrawElement[] = [];
  const frames: ExcalidrawElement[] = [];
  const boundArrows = new Map<string, string[]>();

  const edgeData = (edgeId: string, kind: EdgeKind, toRef: string | undefined) => {
    const boardEdge = boardEdges.get(edgeId);
    const cited = cite(boardEdge?.sourceIds ?? []);
    return {
      edgeId,
      kind,
      // The control a navigation starts from, so the viewer can name it.
      ...(kind === "navigates" && boardEdge !== undefined ? { from: boardEdge.from } : {}),
      ...(toRef !== undefined ? { toRef } : {}),
      ...(cited.length > 0 ? { sources: cited.map(toData) } : {}),
      ...groundingField("edge", edgeId, boardEdge?.priorSourceIds),
    };
  };

  // Edges first, so every node knows which arrows bind to it.
  const arrows: { el: ArrowElement; label?: TextElement; tag?: TextElement }[] = [];
  for (const edge of laidOut.edges) {
    if (edge.marker !== undefined) {
      edgeElements.push(
        ...renderRefMarker(edge, edge.marker, {
          specOnly: markOf("edge", edge.id).dotted,
          frameId: frameIdOf(nodes.get(edge.marker.screenId)?.groupId),
          customData: { groundboard: edgeData(edge.id, edge.kind, edge.toRef) },
        }),
      );
      continue;
    }
    const from = nodes.get(edge.from) as LaidOutNode;
    const to = nodes.get(edge.to) as LaidOutNode;
    const points = [...edge.points];
    points[0] = clipToOutline(points[0] as Point, points[1] as Point, from);
    points[points.length - 1] = clipToOutline(points.at(-1) as Point, points.at(-2) as Point, to);
    const [x0, y0] = points[0] as Point;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const style = EDGE_STYLES[edge.kind];
    const mark = markOf("edge", edge.id);
    const specOnly = mark.dotted;
    const id = edgeElementId(edge.id);
    const frameId =
      from.groupId !== undefined &&
      to.groupId !== undefined &&
      frameIdOf(from.groupId) === frameIdOf(to.groupId)
        ? frameIdOf(from.groupId)
        : null;
    const el = arrow({
      id,
      x: x0,
      y: y0,
      width: round(Math.max(...xs) - Math.min(...xs)),
      height: round(Math.max(...ys) - Math.min(...ys)),
      points: points.map(([x, y]) => [round(x - x0), round(y - y0)]),
      startBinding: binding(nodeElementId(edge.from), points[0] as Point, from),
      endBinding: binding(nodeElementId(edge.to), points.at(-1) as Point, to),
      startArrowhead: style.startArrowhead,
      endArrowhead: style.endArrowhead,
      strokeColor: style.strokeColor,
      strokeStyle: specOnly ? SPEC_STROKE : style.strokeStyle,
      frameId,
      customData: { groundboard: edgeData(edge.id, edge.kind, edge.toRef) },
    });
    for (const nodeId of new Set([edge.from, edge.to])) {
      boundArrows.set(nodeId, [...(boundArrows.get(nodeId) ?? []), id]);
    }
    let label: TextElement | undefined;
    if (edge.label) {
      const [cx, cy] = arrowLabelCenter(points);
      const size = edge.label;
      label = text({
        id: edgeLabelElementId(edge.id),
        x: round(cx - size.width / 2),
        y: round(cy - size.height / 2),
        width: size.width,
        height: size.height,
        text: edge.label.text,
        fontSize: edge.label.fontSize,
        containerId: id,
        strokeColor: style.strokeColor === MUTED ? MUTED : INK,
        frameId,
      });
      el.boundElements = [{ type: "text", id: label.id }];
    }
    let tag: TextElement | undefined;
    if (specOnly) {
      // Beside the label's centre, below the label when there is one.
      const [cx, cy] = arrowLabelCenter(points);
      tag = specTag(`${id}/spec`, cx + 6, cy + (edge.label ? edge.label.height / 2 + 2 : 2), {
        frameId,
        customData: el.customData ?? {},
        ...(mark.tag ? { label: mark.tag } : {}),
      });
    }
    arrows.push({ el, ...(label ? { label } : {}), ...(tag ? { tag } : {}) });
  }

  // Nested groups: a tinted rectangle and a label, sharing an Excalidraw group with their members.
  const nested = laidOut.groups.filter((g) => g.parentId !== undefined);
  nested.sort((a, b) => a.depth - b.depth);
  for (const group of nested) {
    const groupIds = nestedGroupIds(group.id);
    const frameId = frameIdOf(group.id);
    background.push(
      shape("rectangle", {
        id: groupElementId(group.id),
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        backgroundColor: GROUP_TINTS[Math.min(group.depth - 2, GROUP_TINTS.length - 1)],
        strokeColor: "#adb5bd",
        strokeStyle: "dashed",
        roundness: { type: 3 },
        groupIds,
        frameId,
        customData: { groundboard: { groupId: group.id } },
      }),
    );
    const label = wrapText(group.label, Math.max(40, group.width - 24), SMALL_FONT_SIZE);
    const size = measureText(label, SMALL_FONT_SIZE);
    background.push(
      text({
        id: groupLabelElementId(group.id),
        x: group.x + 12,
        y: group.y + 10,
        width: size.width,
        height: size.height,
        text: label,
        fontSize: SMALL_FONT_SIZE,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#495057",
        groupIds,
        frameId,
      }),
    );
  }

  const hasChildren = new Set(
    laidOut.nodes.flatMap((n) => (n.parentId !== undefined ? [n.parentId] : [])),
  );
  const nodeData = (source: BoardNode) => ({
    groundboard: {
      nodeId: source.id,
      kind: source.kind,
      ...(source.detail !== undefined ? { detail: source.detail } : {}),
      ...(source.ref !== undefined ? { ref: source.ref } : {}),
      ...(source.role !== undefined ? { role: source.role } : {}),
      ...(source.action !== undefined ? { action: source.action } : {}),
      ...(source.unresolved !== undefined ? { unresolved: source.unresolved } : {}),
      ...(source.layoutFrom !== undefined ? { layoutFrom: source.layoutFrom } : {}),
      ...(source.platform !== undefined ? { platform: source.platform } : {}),
      sources: cite(source.sourceIds).map(toData),
      ...groundingField("node", source.id, source.priorSourceIds),
    },
  });
  const boundArrowRefs = (nodeId: string) =>
    (boundArrows.get(nodeId) ?? []).map((id) => ({ type: "arrow" as const, id }));

  // Nodes: a shape and its label, or a free text element for notes; screens become frames,
  // elements wireframe parts inside them, and chips small dashed boxes.
  for (const node of laidOut.nodes) {
    if (node.shape === "chip") {
      nodeElements.push(...renderChip(node, boundArrowRefs(node.id)));
      continue;
    }
    if (node.kind === "column") {
      // A column is a row of its table's card: it carries the table's node id, so selecting it
      // selects the table, with the column's own ref and sources (the table's when it has none).
      const tableId = node.screenId as string;
      const table = boardNodes.get(tableId);
      const slug = node.id.slice(node.id.lastIndexOf("/") + 1);
      const column = table ? findColumn(table, slug) : undefined;
      if (!table || !column) continue;
      const cited = cite(column.sourceIds ?? table.sourceIds);
      nodeElements.push(
        ...renderRow(node, {
          customData: {
            groundboard: {
              nodeId: tableId,
              kind: "table",
              column: column.name,
              ...(table.ref !== undefined ? { ref: `${table.ref}/${slug}` } : {}),
              ...(column.note !== undefined ? { detail: column.note } : {}),
              sources: cited.map(toData),
              ...groundingField("node", tableId, table.priorSourceIds),
            },
          },
          link: cited[0] ? sourceLink(board.repo, cited[0]) : null,
          arrows: [],
          dotted: false,
          style: COLUMN_STYLE,
        }),
      );
      continue;
    }
    if (node.kind === "row") {
      // A row of a job's card (its trigger, its retries): selecting it selects the job.
      const job = boardNodes.get(node.screenId as string);
      if (!job) continue;
      nodeElements.push(
        ...renderRow(node, {
          customData: nodeData(job),
          link: null,
          arrows: [],
          dotted: false,
          style: COLUMN_STYLE,
        }),
      );
      continue;
    }
    const source = boardNodes.get(node.id);
    if (!source) throw new Error(`laid-out node ${node.id} is not on the board`);
    const customData = nodeData(source);
    const cited = cite(source.sourceIds);
    const link = cited[0] ? sourceLink(board.repo, cited[0]) : null;
    const arrowsHere = boundArrowRefs(node.id);

    const mark = markOf("node", node.id);
    const specOnly = mark.dotted;
    if (node.shape === "frame") {
      const origin = source.layoutFrom ?? "code";
      frames.push(
        frame({
          id: nodeElementId(node.id),
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          name: `${source.label} · ${source.kind === "screen" ? ORIGIN_LABELS[origin] : `${KIND_LABELS[source.kind]}${source.pathPrefix ? ` ${source.pathPrefix}` : ""}`}${mark.tag === MANUAL_TAG ? " · manual" : specOnly ? " · spec only" : ""}`,
          boundElements: arrowsHere.length > 0 ? arrowsHere : null,
          link,
          customData,
        }),
      );
      continue;
    }
    if (node.shape === "wire" && source.kind !== "element") {
      nodeElements.push(
        ...renderRow(node, {
          customData,
          link,
          arrows: arrowsHere,
          dotted: specOnly,
          ...(mark.tag ? { tag: mark.tag } : {}),
        }),
      );
      continue;
    }
    if (node.shape === "wire") {
      nodeElements.push(
        ...renderWire(node, source, {
          customData,
          link,
          arrows: arrowsHere,
          hasChildren: hasChildren.has(node.id),
          specOnly,
          ...(mark.tag ? { tag: mark.tag } : {}),
        }),
      );
      continue;
    }

    const style = NODE_STYLES[node.kind as NodeKind];
    const groupIds = nestedGroupIds(node.groupId);
    const frameId = frameIdOf(node.groupId);

    if (node.shape === "text") {
      nodeElements.push(
        text({
          id: nodeElementId(node.id),
          x: node.x,
          y: node.y,
          width: node.textWidth,
          height: node.textHeight,
          text: node.text,
          fontSize: node.fontSize,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: style.textColor,
          boundElements: arrowsHere.length > 0 ? arrowsHere : null,
          groupIds,
          frameId,
          link,
          customData,
        }),
      );
      continue;
    }

    const shapeId = nodeElementId(node.id);
    const labelId = labelElementId(node.id);
    nodeElements.push(
      shape(node.shape, {
        id: shapeId,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        strokeColor: style.strokeColor,
        backgroundColor: style.backgroundColor,
        strokeStyle: specOnly ? SPEC_STROKE : style.strokeStyle,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
        roundness:
          node.shape === "rectangle" ? { type: 3 } : node.shape === "diamond" ? { type: 2 } : null,
        boundElements: [{ type: "text", id: labelId }, ...arrowsHere],
        groupIds,
        frameId,
        link,
        customData,
      }),
    );
    nodeElements.push(
      text({
        id: labelId,
        x: round(node.x + (node.width - node.textWidth) / 2),
        y: round(node.y + (node.height - node.textHeight) / 2),
        width: node.textWidth,
        height: node.textHeight,
        text: node.text,
        fontSize: node.fontSize,
        containerId: shapeId,
        strokeColor: style.textColor,
        groupIds,
        frameId,
      }),
    );
    if (mark.tag === MANUAL_TAG) {
      // Above the box's top left corner: what a person added is never read as checked.
      nodeElements.push(
        specTag(`${shapeId}/manual`, node.x, node.y - TAG_FONT_SIZE * 1.25 - 2, {
          frameId,
          customData,
          label: MANUAL_TAG,
        }),
      );
    }
  }

  for (const { el, label, tag } of arrows) {
    edgeElements.push(el);
    if (label) edgeElements.push(label);
    if (tag) edgeElements.push(tag);
  }

  for (const group of laidOut.groups) {
    if (group.parentId !== undefined) continue;
    frames.push(
      frame({
        id: groupElementId(group.id),
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        name: group.label,
        customData: { groundboard: { groupId: group.id } },
      }),
    );
  }

  const drawn =
    options.references === undefined || laidOut.references === undefined
      ? { images: [], overlays: [], files: {} }
      : renderReferences(laidOut, board, options.references, {
          node: nodeData,
          edge: (edgeId) => {
            const edge = boardEdges.get(edgeId);
            return { groundboard: edgeData(edgeId, edge?.kind ?? "navigates", edge?.toRef) };
          },
        });
  const specClaims = claims.some((c) => c.grounding === "spec");
  const legend = renderLegend(
    laidOut.width + 80,
    20,
    laidOut,
    board,
    specClaims,
    drawn.images.length > 0,
  );
  const codeClaims = claims.filter((c) => c.grounding === "code").length;
  const coverage =
    codeClaims === claims.length ? null : `${codeClaims} of ${claims.length} claims backed by code`;
  const title = renderTitle(laidOut, board, options.sourcesChecked ?? null, coverage);

  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: [
      ...title,
      ...drawn.images,
      ...background,
      ...nodeElements,
      ...edgeElements,
      ...frames,
      ...drawn.overlays,
      ...legend,
      ...renderNotes(options.notes ?? []),
    ],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: drawn.files,
  };
}

/**
 * One row of a card (an endpoint of a resource, a column of a table): a tinted box with its
 * text, carrying the node's data and binding its arrows, inside the card's frame.
 */
function renderRow(
  node: LaidOutNode,
  options: {
    customData: Record<string, unknown>;
    link: string | null;
    arrows: { type: "arrow"; id: string }[];
    dotted: boolean;
    tag?: string;
    /** The row's colours; the node kind's by default. */
    style?: NodeStyle;
  },
): ExcalidrawElement[] {
  const style = options.style ?? NODE_STYLES[node.kind as NodeKind];
  const frameId = nodeElementId(node.screenId as string);
  const id = nodeElementId(node.id);
  const out: ExcalidrawElement[] = [
    shape("rectangle", {
      id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      strokeColor: style.strokeColor,
      backgroundColor: style.backgroundColor,
      strokeStyle: options.dotted ? SPEC_STROKE : style.strokeStyle,
      roundness: { type: 3 },
      boundElements: options.arrows.length > 0 ? options.arrows : null,
      frameId,
      link: options.link,
      customData: options.customData,
    }),
    text({
      id: `${id}/text`,
      x: node.textX ?? node.x,
      y: node.textY ?? node.y,
      width: node.textWidth,
      height: node.textHeight,
      text: node.text,
      fontSize: node.fontSize,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: style.textColor,
      frameId,
      customData: options.customData,
    }),
  ];
  if (options.dotted) {
    const label = options.tag ?? SPEC_TAG;
    const size = measureText(label, TAG_FONT_SIZE);
    out.push(
      specTag(`${id}/spec`, node.x + node.width - size.width - 6, node.y + 2, {
        frameId,
        customData: options.customData,
        label,
      }),
    );
  }
  return out;
}

interface WireOptions {
  customData: Record<string, unknown>;
  link: string | null;
  arrows: { type: "arrow"; id: string }[];
  hasChildren: boolean;
  /** Backed only by a specification, or added by hand: dotted outline and a tag. */
  specOnly: boolean;
  /** The tag's text; "spec" when absent. */
  tag?: string;
}

/**
 * One element of a wireframe: its main shape (or text, for text and link roles) carries the
 * node's data and binds its label and arrows; small marks show the role, a cited handler (a
 * dot) or an unresolved one (`?`). No group ids: one click selects exactly this element.
 */
function renderWire(
  node: LaidOutNode,
  source: BoardNode,
  options: WireOptions,
): ExcalidrawElement[] {
  const role = node.role ?? "container";
  const style = ROLE_STYLES[role];
  const frameId = nodeElementId(node.screenId as string);
  const { customData, link } = options;
  const id = nodeElementId(node.id);
  const textX = node.textX ?? node.x;
  const textY = node.textY ?? node.y;
  const out: ExcalidrawElement[] = [];
  const decoration = { frameId, customData, strokeColor: INK };

  if (role === "text" || role === "link") {
    out.push(
      text({
        id,
        x: textX,
        y: textY,
        width: node.textWidth,
        height: node.textHeight,
        text: node.text,
        fontSize: node.fontSize,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: style.textColor,
        boundElements: options.arrows.length > 0 ? options.arrows : null,
        frameId,
        link,
        customData,
      }),
    );
    if (role === "link") {
      const underlineY = round(textY + node.textHeight);
      out.push(
        line({
          id: `${id}/underline`,
          x: textX,
          y: underlineY,
          width: node.textWidth,
          height: 0,
          points: [
            [0, 0],
            [node.textWidth, 0],
          ],
          ...decoration,
          strokeColor: LINK_COLOR,
        }),
      );
    }
  } else {
    const labelId = labelElementId(node.id);
    out.push(
      shape("rectangle", {
        id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        strokeColor: style.strokeColor,
        backgroundColor: style.backgroundColor,
        ...(options.specOnly ? { strokeStyle: SPEC_STROKE } : {}),
        roundness: style.rounded ? { type: 3 } : null,
        boundElements: [{ type: "text", id: labelId }, ...options.arrows],
        frameId,
        link,
        customData,
      }),
      text({
        id: labelId,
        x: textX,
        y: textY,
        width: node.textWidth,
        height: node.textHeight,
        text: node.text,
        fontSize: node.fontSize,
        textAlign: role === "button" || role === "image" ? "center" : "left",
        verticalAlign: options.hasChildren ? "top" : "middle",
        containerId: id,
        strokeColor: style.textColor,
        frameId,
      }),
    );
    const midY = node.y + node.height / 2;
    if (role === "checkbox") {
      out.push(
        shape("rectangle", {
          id: `${id}/box`,
          x: round(node.x + 6),
          y: round(midY - 9),
          width: 18,
          height: 18,
          ...decoration,
        }),
      );
    } else if (role === "icon") {
      out.push(
        shape("ellipse", {
          id: `${id}/circle`,
          x: round(node.x + 6),
          y: round(midY - 12),
          width: 24,
          height: 24,
          ...decoration,
        }),
      );
    } else if (role === "image" && !options.hasChildren) {
      const w = node.width;
      const h = node.height;
      out.push(
        line({
          id: `${id}/diag1`,
          x: node.x,
          y: node.y,
          width: w,
          height: h,
          points: [
            [0, 0],
            [w, h],
          ],
          ...decoration,
          strokeColor: "#ced4da",
        }),
        line({
          id: `${id}/diag2`,
          x: node.x,
          y: round(node.y + h),
          width: w,
          height: h,
          points: [
            [0, 0],
            [w, -h],
          ],
          ...decoration,
          strokeColor: "#ced4da",
        }),
      );
    }
  }

  if (options.specOnly) {
    // Top right, left of the handler dot, inside the element's box.
    const label = options.tag ?? SPEC_TAG;
    const tag = measureText(label, TAG_FONT_SIZE);
    out.push(
      specTag(`${id}/spec`, Math.max(node.x, node.x + node.width - 16 - tag.width), node.y + 1, {
        frameId,
        customData,
        label,
      }),
    );
  }
  if (source.unresolved !== undefined) {
    const mark = measureText("?", SMALL_FONT_SIZE);
    out.push(
      text({
        id: `${id}/unresolved`,
        x: round(node.x + node.width - mark.width - 4),
        y: round(node.y + 2),
        width: mark.width,
        height: mark.height,
        text: "?",
        fontSize: SMALL_FONT_SIZE,
        textAlign: "left",
        verticalAlign: "top",
        ...decoration,
        strokeColor: UNRESOLVED_COLOR,
      }),
    );
  } else if (source.action !== undefined) {
    out.push(
      shape("ellipse", {
        id: `${id}/action`,
        x: round(node.x + node.width - 12),
        y: round(node.y + 4),
        width: 8,
        height: 8,
        ...decoration,
        strokeColor: ACCENT,
        backgroundColor: ACCENT,
      }),
    );
  }
  return out;
}

/**
 * A `toRef` edge on a screen board: a numbered tag on its source and a list line beside the
 * frame naming the target. All three carry the edge's data and share one Excalidraw group, so
 * selecting either selects the pair and dragging one moves both. None belongs to the screen's
 * frame, since the tag may reach past its edge and the line lies outside it; all belong to the
 * frame of the screen's top-level group, if any, as an arrow inside that group does.
 */
function renderRefMarker(
  edge: LaidOutEdge,
  marker: LaidOutRefMarker,
  options: { specOnly: boolean; frameId: string | null; customData: Record<string, unknown> },
): ExcalidrawElement[] {
  const { tag, line } = marker;
  const groupIds = [`ref-${edge.id}`];
  const common = {
    groupIds,
    frameId: options.frameId,
    customData: options.customData,
    strokeColor: ACCENT,
  };
  const number = measureText(tag.text, tag.fontSize);
  return [
    shape("rectangle", {
      id: refTagElementId(edge.id),
      x: tag.x,
      y: tag.y,
      width: tag.width,
      height: tag.height,
      backgroundColor: "#ffffff",
      strokeStyle: options.specOnly ? SPEC_STROKE : "dashed",
      roundness: { type: 3 },
      ...common,
    }),
    text({
      id: `${refTagElementId(edge.id)}/number`,
      x: round(tag.x + (tag.width - number.width) / 2),
      y: round(tag.y + (tag.height - number.height) / 2),
      width: number.width,
      height: number.height,
      text: tag.text,
      fontSize: tag.fontSize,
      ...common,
    }),
    text({
      id: refLineElementId(edge.id),
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      text: line.text,
      fontSize: line.fontSize,
      textAlign: "left",
      verticalAlign: "top",
      ...common,
    }),
  ];
}

/** A dashed box naming a screen on another board, the target of `toRef` edges. */
function renderChip(
  node: LaidOutNode,
  arrows: { type: "arrow"; id: string }[],
): ExcalidrawElement[] {
  const id = nodeElementId(node.id);
  const labelId = labelElementId(node.id);
  const customData = { groundboard: { nodeId: node.id, kind: "ref", ref: node.ref } };
  return [
    shape("rectangle", {
      id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      strokeColor: ACCENT,
      strokeStyle: "dashed",
      roundness: { type: 3 },
      boundElements: [{ type: "text", id: labelId }, ...arrows],
      customData,
    }),
    text({
      id: labelId,
      x: round(node.x + (node.width - node.textWidth) / 2),
      y: round(node.y + (node.height - node.textHeight) / 2),
      width: node.textWidth,
      height: node.textHeight,
      text: node.text,
      fontSize: node.fontSize,
      containerId: id,
      strokeColor: INK,
    }),
  ];
}

type LegendRow = {
  key: string;
  label: string;
  swatch: (id: string, x: number, y: number) => ExcalidrawElement;
};

/**
 * The legend lists the flow kinds when the board has any flow node (as it always did, so the
 * scenes of flow boards do not change), and each wireframe part only when the board has it.
 */
function renderLegend(
  x: number,
  y: number,
  laidOut: LaidOutBoard,
  board: Board,
  specClaims: boolean,
  references: boolean,
): ExcalidrawElement[] {
  const rowHeight = 40;
  const rows: LegendRow[] = [];
  const kinds = new Set(board.nodes.map((n) => n.kind));
  if (board.nodes.some((n) => n.kind !== "screen" && n.kind !== "element")) {
    for (const kind of FLOW_KINDS) {
      const style = NODE_STYLES[kind];
      rows.push({
        key: kind,
        label: KIND_LABELS[kind],
        swatch: (id, sx, sy) => {
          if (kind === "note") {
            const size = measureText("Aa", SMALL_FONT_SIZE);
            return text({
              id,
              x: sx,
              y: sy + 4,
              width: size.width,
              height: size.height,
              text: "Aa",
              fontSize: SMALL_FONT_SIZE,
              textAlign: "left",
              verticalAlign: "top",
              strokeColor: style.textColor,
              frameId: "legend",
            });
          }
          const shapeType =
            kind === "state" ? "ellipse" : kind === "decision" ? "diamond" : "rectangle";
          return shape(shapeType, {
            id,
            x: sx,
            y: sy,
            width: 44,
            height: 28,
            strokeColor: style.strokeColor,
            backgroundColor: style.backgroundColor,
            strokeStyle: style.strokeStyle,
            strokeWidth: style.strokeWidth,
            roundness: shapeType === "rectangle" ? { type: 3 } : null,
            frameId: "legend",
          });
        },
      });
    }
  }
  const box = (id: string, sx: number, sy: number, props: Partial<Parameters<typeof shape>[1]>) =>
    shape("rectangle", { id, x: sx, y: sy, width: 44, height: 28, frameId: "legend", ...props });
  if (kinds.has("element")) {
    rows.push({
      key: "element-action",
      label: "element with a cited handler",
      swatch: (id, sx, sy) =>
        box(id, sx, sy, { backgroundColor: "#e9ecef", roundness: { type: 3 } }),
    });
    if (board.nodes.some((n) => n.unresolved !== undefined)) {
      rows.push({
        key: "element-unresolved",
        label: "? handler not found",
        swatch: (id, sx, sy) => box(id, sx, sy, { strokeColor: UNRESOLVED_COLOR }),
      });
    }
  }
  if (laidOut.nodes.some((n) => n.shape === "chip")) {
    rows.push({
      key: "ref",
      label: "screen on another board",
      swatch: (id, sx, sy) =>
        box(id, sx, sy, { strokeColor: ACCENT, strokeStyle: "dashed", roundness: { type: 3 } }),
    });
  }
  const edgeSwatch =
    (strokeColor: string) =>
    (id: string, sx: number, sy: number): ExcalidrawElement =>
      line({
        id,
        x: sx,
        y: sy + 14,
        width: 44,
        height: 0,
        points: [
          [0, 0],
          [44, 0],
        ],
        strokeColor,
        frameId: "legend",
      });
  // A board that draws the states of a screen tells a change of state from a navigation.
  const screenIds = new Set(board.nodes.filter((n) => n.kind === "screen").map((n) => n.id));
  const screenTransitions = board.edges.some(
    (e) => e.kind === "transition" && e.to !== undefined && screenIds.has(e.to),
  );
  if (laidOut.edges.some((e) => e.marker !== undefined)) {
    rows.push({
      key: "ref-marker",
      label: "1 → ref: opens a screen on another board",
      swatch: (id, sx, sy) =>
        shape("rectangle", {
          id,
          x: sx,
          y: sy + 6,
          width: 16,
          height: 16,
          strokeColor: ACCENT,
          strokeStyle: "dashed",
          roundness: { type: 3 },
          frameId: "legend",
        }),
    });
  }
  if (laidOut.edges.some((e) => e.kind === "navigates" && e.marker === undefined)) {
    rows.push({
      key: "navigates",
      label: screenTransitions ? "navigates: opens another screen" : "navigates",
      swatch: edgeSwatch(ACCENT),
    });
  }
  if (screenTransitions) {
    rows.push({
      key: "transition",
      label: "transition: another state of the same screen",
      swatch: edgeSwatch(EDGE_STYLES.transition.strokeColor),
    });
  }

  if (specClaims) {
    rows.push({
      key: "spec",
      label: "spec only: a document, Figma, mockup or link; no code yet",
      swatch: (id, sx, sy) =>
        box(id, sx, sy, {
          strokeColor: SPEC_COLOR,
          strokeStyle: SPEC_STROKE,
          roundness: { type: 3 },
        }),
    });
  }

  if (references) {
    rows.push({
      key: "reference",
      label: "Figma reference: boxes and numbers match the wireframe",
      swatch: (id, sx, sy) => box(id, sx, sy, { strokeColor: LINK_COLOR, strokeWidth: 2 }),
    });
  }

  const out: ExcalidrawElement[] = [];
  rows.forEach((row, i) => {
    const rowY = y + 20 + i * rowHeight;
    // The reference row goes with the images when a viewer hides them.
    const prefix = row.key === "reference" ? REFERENCE_PREFIX : "";
    out.push(row.swatch(`${prefix}legend-swatch/${row.key}`, x + 20, rowY));
    const size = measureText(row.label, SMALL_FONT_SIZE);
    out.push(
      text({
        id: `${prefix}legend-label/${row.key}`,
        x: x + 80,
        y: rowY + 5,
        width: size.width,
        height: size.height,
        text: row.label,
        fontSize: SMALL_FONT_SIZE,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: INK,
        frameId: "legend",
      }),
    );
  });
  const width = Math.max(
    220,
    ...rows.map((r) => 100 + measureText(r.label, SMALL_FONT_SIZE).width),
  );
  out.push(
    frame({
      id: "legend",
      x,
      y,
      width,
      height: 20 + rows.length * rowHeight,
      name: "Legend",
    }),
  );
  return out;
}

function renderTitle(
  laidOut: LaidOutBoard,
  board: Board,
  sourcesChecked: SourcesChecked | null,
  coverage: string | null,
): ExcalidrawElement[] {
  const maxWidth = Math.max(600, laidOut.width - 40);
  const titleSize = 28;
  const questionSize = 20;
  const titleText = wrapText(board.title, maxWidth, titleSize);
  const questionText = wrapText(board.question, maxWidth, questionSize);
  const status = statusLine(sourcesChecked);
  const t = measureText(titleText, titleSize);
  const q = measureText(questionText, questionSize);
  const s = measureText(status, FONT_SIZE);
  // Lines under the status, each in orange: sources that cannot be checked, then coverage.
  const notes: Array<{ id: string; text: string }> = [];
  const unchecked = board.sources.filter((source) => !isCheckable(source));
  if (unchecked.length > 0) {
    const plural = unchecked.length === 1 ? "" : "s";
    // A board whose only unchecked sources are Figma nodes keeps the wording it always had.
    notes.push({
      id: "title-figma",
      text: unchecked.every((source) => source.kind === "figma")
        ? `${unchecked.length} Figma source${plural} not checked`
        : `${unchecked.length} source${plural} not checked (Figma, links, mockups without a file)`,
    });
  }
  if (coverage !== null) notes.push({ id: "title-grounding", text: coverage });
  const sizes = notes.map((note) => measureText(note.text, FONT_SIZE));
  const notesHeight = sizes.reduce((sum, size) => sum + size.height + 4, 0);
  const statusY = -24 - s.height - notesHeight;
  const questionY = statusY - 8 - q.height;
  const titleY = questionY - 8 - t.height;
  let noteY = statusY + s.height + 4;
  const noteElements = notes.map((note, i) => {
    const size = sizes[i] as { width: number; height: number };
    const el = text({
      id: note.id,
      x: 20,
      y: noteY,
      width: size.width,
      height: size.height,
      text: note.text,
      fontSize: FONT_SIZE,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: "#e8590c",
    });
    noteY += size.height + 4;
    return el;
  });
  return [
    text({
      id: "title",
      x: 20,
      y: titleY,
      width: t.width,
      height: t.height,
      text: titleText,
      fontSize: titleSize,
      textAlign: "left",
      verticalAlign: "top",
      customData: {
        groundboard: {
          question: board.question,
          sourcesChecked: sourcesChecked ?? false,
          ...(board.repo?.commit ? { commit: board.repo.commit } : {}),
        },
      },
    }),
    text({
      id: "title-question",
      x: 20,
      y: questionY,
      width: q.width,
      height: q.height,
      text: questionText,
      fontSize: questionSize,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: "#343a40",
    }),
    text({
      id: "title-status",
      x: 20,
      y: statusY,
      width: s.width,
      height: s.height,
      text: status,
      fontSize: FONT_SIZE,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: sourcesChecked ? "#2f9e44" : "#e8590c",
    }),
    ...noteElements,
  ];
}
