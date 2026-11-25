import type { BoardNode } from "./board.ts";
import { parseRef, REF_SLUG_MAX } from "./ref.ts";

/**
 * The slug of a column in its ref, so that `customerId` and `customer_id` name one column:
 * camelCase split into words, lowercase, `_`, spaces and `.` become `-`, runs of `-` collapse.
 * Null when it would be longer than a ref slug may be.
 */
export function columnSlug(name: string): string | null {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") return null;
  return slug.length > REF_SLUG_MAX ? null : slug;
}

/** The slug of a table in its ref: its name lowercased, `_` and other separators as `-`. */
export function tableSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The refs a table defines for its columns: `db:<table>/<column-slug>`, in column order. */
export function columnRefs(node: Pick<BoardNode, "kind" | "ref" | "columns">): string[] {
  if (node.kind !== "table" || node.ref === undefined || !node.columns) return [];
  const parsed = parseRef(node.ref);
  if (parsed === null || parsed.namespace !== "db" || "platform" in parsed) return [];
  const refs: string[] = [];
  for (const column of node.columns) {
    const slug = columnSlug(column.name);
    if (slug !== null) refs.push(`${parsed.rootRef}/${slug}`);
  }
  return refs;
}

/** The column of a table a ref or a column name names, by slug; undefined when there is none. */
export function findColumn(
  node: Pick<BoardNode, "columns">,
  nameOrSlug: string,
): NonNullable<BoardNode["columns"]>[number] | undefined {
  const wanted = columnSlug(nameOrSlug);
  return node.columns?.find((c) => columnSlug(c.name) === wanted);
}
