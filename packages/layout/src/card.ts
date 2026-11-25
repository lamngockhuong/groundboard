import { type Board, type BoardNode, columnSlug } from "@groundboard/schema";
import { measureText, wrapText } from "./measure.ts";
import { FONT_SIZE } from "./text.ts";
import type { ScreenLayout, WireBox } from "./wireframe.ts";

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

export interface CardRow {
  id: string;
  text: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Stacks rows from the top of a card, each as tall as its wrapped text. */
export function layoutCard(rows: readonly CardRow[], width = CARD_WIDTH): ScreenLayout {
  const inner = width - 2 * PADDING;
  const boxes: WireBox[] = [];
  let y = PADDING;
  for (const row of rows) {
    const text = wrapText(row.text, Math.max(60, inner - 2 * ROW_PAD_X), FONT_SIZE);
    const size = measureText(text, FONT_SIZE);
    const height = round(size.height + 2 * ROW_PAD_Y);
    boxes.push({
      id: row.id,
      x: PADDING,
      y: round(y),
      width: round(inner),
      height,
      text,
      fontSize: FONT_SIZE,
      textX: PADDING + ROW_PAD_X,
      textY: round(y + ROW_PAD_Y),
      textWidth: size.width,
      textHeight: size.height,
    });
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
  for (const node of board.nodes) {
    if (node.kind !== "endpoint" || node.parentId === undefined) continue;
    cards.get(node.parentId)?.push({ id: node.id, text: endpointRowText(node) });
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
