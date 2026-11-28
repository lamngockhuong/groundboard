import { type Board, type BoardEdge, type BoardNode, columnSlug } from "@groundboard/schema";
import { measureText, wrapText } from "./measure.ts";
import { FONT_SIZE, SMALL_FONT_SIZE } from "./text.ts";
import type { ScreenLayout, WireBox, WireRowParts, WireRowTag } from "./wireframe.ts";

/**
 * A card: a box with a title and one row per item, laid out here and placed by ELK as one
 * fixed-size node, like a screen's wireframe. An API resource is a card of its endpoints; the
 * edges of a row attach to the row.
 */

/** Width of a card; its rows wrap inside it. */
export const CARD_WIDTH = 340;
const PADDING = 10;
const ROW_GAP = 4;
const ROW_PAD_X = 8;
const ROW_PAD_Y = 6;
/** Space between the parts of an endpoint's row: its route, its guard line, its tags. */
const PART_GAP = 4;
const TAG_PAD_X = 6;
const TAG_PAD_Y = 2;
const TAG_GAP = 6;

/** The kinds of edge drawn as a tag inside the row of the endpoint they start at. */
export const ROW_TAG_KINDS = ["reads", "writes", "enqueues"] as const;
export type RowTagKind = (typeof ROW_TAG_KINDS)[number];

export interface CardRowTag {
  edgeId: string;
  ref: string;
  kind: RowTagKind;
  text: string;
}

export interface CardRow {
  id: string;
  text: string;
  /**
   * An endpoint's guard line: the names of its guards, or "no guard found" (`empty`) when the
   * handler was read and attaches none. Absent when the handler was not read.
   */
  guard?: { text: string; empty: boolean };
  /** An endpoint's reads, writes and enqueues of other boards' tables and jobs. */
  tags?: CardRowTag[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Stacks rows from the top of a card, each as tall as its wrapped text. */
export function layoutCard(rows: readonly CardRow[], width = CARD_WIDTH): ScreenLayout {
  const inner = width - 2 * PADDING;
  const boxes: WireBox[] = [];
  let y = PADDING;
  const textWidth = Math.max(60, inner - 2 * ROW_PAD_X);
  for (const row of rows) {
    const text = wrapText(row.text, textWidth, FONT_SIZE);
    const size = measureText(text, FONT_SIZE);
    const left = PADDING + ROW_PAD_X;
    let bottom = y + ROW_PAD_Y + size.height;
    const parts: WireRowParts = { tags: [] };
    if (row.guard !== undefined) {
      const guardText = wrapText(row.guard.text, textWidth, SMALL_FONT_SIZE);
      const guardSize = measureText(guardText, SMALL_FONT_SIZE);
      parts.guard = {
        text: guardText,
        fontSize: SMALL_FONT_SIZE,
        x: left,
        y: round(bottom + PART_GAP),
        width: guardSize.width,
        height: guardSize.height,
        empty: row.guard.empty,
      };
      bottom += PART_GAP + guardSize.height;
    }
    if (row.tags !== undefined && row.tags.length > 0) {
      // Tags flow left to right in edge order and wrap to the next line at the row's edge.
      let x = left;
      let lineTop = bottom + PART_GAP;
      let lineHeight = 0;
      for (const tag of row.tags) {
        const tagText = measureText(tag.text, SMALL_FONT_SIZE);
        const width = Math.min(textWidth, tagText.width + 2 * TAG_PAD_X);
        const height = tagText.height + 2 * TAG_PAD_Y;
        if (x > left && x + width > left + textWidth) {
          x = left;
          lineTop += lineHeight + TAG_GAP / 2;
          lineHeight = 0;
        }
        parts.tags.push({
          edgeId: tag.edgeId,
          ref: tag.ref,
          kind: tag.kind,
          text: tag.text,
          fontSize: SMALL_FONT_SIZE,
          x: round(x),
          y: round(lineTop),
          width: round(width),
          height,
          textWidth: tagText.width,
          textHeight: tagText.height,
        } satisfies WireRowTag);
        x += width + TAG_GAP;
        lineHeight = Math.max(lineHeight, height);
      }
      bottom = lineTop + lineHeight;
    }
    const height = round(bottom + ROW_PAD_Y - y);
    const box: WireBox = {
      id: row.id,
      x: PADDING,
      y: round(y),
      width: round(inner),
      height,
      text,
      fontSize: FONT_SIZE,
      textX: left,
      textY: round(y + ROW_PAD_Y),
      textWidth: size.width,
      textHeight: size.height,
    };
    if (parts.guard !== undefined || parts.tags.length > 0) box.parts = parts;
    boxes.push(box);
    y += height + ROW_GAP;
  }
  const height = rows.length === 0 ? 2 * PADDING + 20 : round(y - ROW_GAP + PADDING);
  return { width, height, boxes };
}

/** The text of an endpoint's row: its method and path, then its label. */
export function endpointRowText(node: Pick<BoardNode, "method" | "path" | "label">): string {
  const route = [node.method, node.path].filter(Boolean).join(" ");
  return route === "" ? node.label : `${route}  ${node.label}`;
}

/** The guard line of an endpoint's row, or undefined when its handler was not read. */
export function endpointGuardText(
  node: Pick<BoardNode, "guards">,
): { text: string; empty: boolean } | undefined {
  if (node.guards === undefined) return undefined;
  if (node.guards.length === 0) return { text: "no guard found", empty: true };
  return { text: `guard: ${node.guards.map((g) => g.name).join(" · ")}`, empty: false };
}

/**
 * Whether an edge is drawn as a tag in the row of the endpoint it starts at: a read, a write or
 * an enqueue of a table or a job on another board. Such an edge has no arrow, chip or marker.
 */
export function isRowTagEdge(
  edge: Pick<BoardEdge, "kind" | "toRef" | "from">,
  kindOf: ReadonlyMap<string, string>,
): edge is Pick<BoardEdge, "kind" | "from"> & { kind: RowTagKind; toRef: string } {
  return (
    edge.toRef !== undefined &&
    (ROW_TAG_KINDS as readonly string[]).includes(edge.kind) &&
    kindOf.get(edge.from) === "endpoint"
  );
}

/** The text of a row tag: the edge kind and the ref without its namespace, `writes orders`. */
export function rowTagText(kind: RowTagKind, ref: string): string {
  return `${kind} ${ref.slice(ref.indexOf(":") + 1)}`;
}

/**
 * Node kinds drawn as a card: a resource's rows are its endpoints, a table's its columns, a
 * job's its trigger and its retry policy.
 */
export const CARD_KINDS = { resource: "endpoint", table: "column", job: "row" } as const;

/**
 * The id of a column's row in a table's card. A column is not a node: `@` and `/` appear in no
 * node id, so the row's id cannot meet one.
 */
export const COLUMN_PREFIX = "@col:";
export const columnRowId = (tableId: string, slug: string) => `${COLUMN_PREFIX}${tableId}/${slug}`;
/** The id of an information row of a job's card: `trigger` or `retry`. */
export const INFO_PREFIX = "@row:";
export const infoRowId = (jobId: string, part: "trigger" | "retry") =>
  `${INFO_PREFIX}${jobId}/${part}`;

/** The text of a job's trigger row: `cron 0 2 * * *`, `queue: receipts`, `event: order.paid`. */
export function triggerRowText(trigger: NonNullable<BoardNode["trigger"]>): string {
  switch (trigger.type) {
    case "cron":
      return `cron ${trigger.schedule ?? ""}`.trim();
    case "queue":
      return `queue: ${trigger.queue ?? ""}`;
    case "event":
      return `event: ${trigger.event ?? ""}`;
    default:
      return "manual";
  }
}

/** The text of a job's retry row, or null when it declares neither retries nor a timeout. */
export function retryRowText(node: Pick<BoardNode, "retry" | "timeout">): string | null {
  const parts = [
    node.retry
      ? `retry ${node.retry.attempts}${node.retry.backoff ? ` (${node.retry.backoff})` : ""}`
      : "",
    node.timeout ? `timeout ${node.timeout}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The text of a column's row: its name, its type, then PK, FK, NULL and UQ as they apply. */
export function columnRowText(
  column: NonNullable<BoardNode["columns"]>[number],
  foreignKey: boolean,
): string {
  const flags = [
    column.pk ? "PK" : "",
    foreignKey ? "FK" : "",
    column.nullable ? "NULL" : "",
    column.unique ? "UQ" : "",
  ].filter(Boolean);
  return [column.name, column.type ?? "", flags.join(" ")].filter(Boolean).join("  ");
}

/** The rows of every card on a board, by card id, in board order. */
export function cardRows(board: Pick<Board, "nodes" | "edges">): Map<string, CardRow[]> {
  const cards = new Map<string, CardRow[]>();
  for (const node of board.nodes) {
    if (node.kind in CARD_KINDS) cards.set(node.id, []);
  }
  const kindOf = new Map(board.nodes.map((n) => [n.id, n.kind]));
  const tagsOf = new Map<string, CardRowTag[]>();
  for (const edge of board.edges) {
    if (!isRowTagEdge(edge, kindOf)) continue;
    const tag = {
      edgeId: edge.id,
      ref: edge.toRef,
      kind: edge.kind,
      text: rowTagText(edge.kind, edge.toRef),
    };
    tagsOf.set(edge.from, [...(tagsOf.get(edge.from) ?? []), tag]);
  }
  for (const node of board.nodes) {
    if (node.kind !== "endpoint" || node.parentId === undefined) continue;
    const row: CardRow = { id: node.id, text: endpointRowText(node) };
    const guard = endpointGuardText(node);
    if (guard !== undefined) row.guard = guard;
    const tags = tagsOf.get(node.id);
    if (tags !== undefined) row.tags = tags;
    cards.get(node.parentId)?.push(row);
  }
  // A column that holds a foreign key reads FK.
  const keys = new Set(
    board.edges
      .filter((e) => e.kind === "references" && e.fromColumn !== undefined)
      .map((e) => `${e.from} ${columnSlug(e.fromColumn as string)}`),
  );
  for (const node of board.nodes) {
    if (node.kind !== "table") continue;
    const rows = cards.get(node.id) as CardRow[];
    for (const column of node.columns ?? []) {
      const slug = columnSlug(column.name);
      if (slug === null) continue;
      rows.push({
        id: columnRowId(node.id, slug),
        text: columnRowText(column, keys.has(`${node.id} ${slug}`)),
      });
    }
  }
  for (const node of board.nodes) {
    if (node.kind !== "job") continue;
    const rows = cards.get(node.id) as CardRow[];
    if (node.trigger)
      rows.push({ id: infoRowId(node.id, "trigger"), text: triggerRowText(node.trigger) });
    const retry = retryRowText(node);
    if (retry !== null) rows.push({ id: infoRowId(node.id, "retry"), text: retry });
  }
  return cards;
}
