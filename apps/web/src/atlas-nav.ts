import { ATLAS_BOARD_KINDS } from "@groundboard/schema";
import type { AtlasBoard, AtlasBoardKind, AtlasIndex, AtlasPlace } from "./api.ts";
import { t } from "./i18n.ts";

/** The board groups in the order the sidebar and the atlas home show them. */
export const GROUPS: ReadonlyArray<{ kind: AtlasBoardKind }> = ATLAS_BOARD_KINDS.map((kind) => ({
  kind,
}));

const isGroupKind = (kind: string): kind is AtlasBoardKind => GROUPS.some((g) => g.kind === kind);

/** A group's name in the interface language: "Screens"; an unknown kind as it is. */
export const groupTitle = (kind: string): string => (isGroupKind(kind) ? t(`group.${kind}`) : kind);

/** One board of a group: "Screen"; an unknown kind as it is. */
export const groupSingular = (kind: string): string =>
  isGroupKind(kind) ? t(`group.${kind}.one`) : kind;

export const statusLabel = (status: AtlasBoard["status"]): string => t(`status.${status}`);

const ORIGINS = ["figma", "screenshot", "mockup", "doc", "code"] as const;

/** Where a board's layout came from, as the toolbar badge says it; an unknown origin as it is. */
export function originLabel(origin: string): string {
  const known = ORIGINS.find((o) => o === origin);
  return known ? t(`origin.${known}`) : origin;
}

const groupIndex = (kind: AtlasBoardKind) => GROUPS.findIndex((g) => g.kind === kind);

/** Every board, grouped by kind in `GROUPS` order; within a group, in index order. */
export function orderedBoards(atlas: AtlasIndex): AtlasBoard[] {
  // Array#sort is stable, so boards of one kind keep the order the index gave them.
  return [...atlas.boards].sort((a, b) => groupIndex(a.kind) - groupIndex(b.kind));
}

/**
 * Boards whose title, slug or a tag contains the query, ignoring case, and that carry `tag` when
 * one is given; all of them when both are blank.
 */
export function filterBoards(
  boards: readonly AtlasBoard[],
  query: string,
  tag: string | null = null,
): AtlasBoard[] {
  const needle = query.trim().toLowerCase();
  return boards.filter(
    (b) =>
      (tag === null || b.tags.includes(tag)) &&
      (needle === "" || `${b.title} ${b.slug} ${b.tags.join(" ")}`.toLowerCase().includes(needle)),
  );
}

const byText = (a: string, b: string) => a.localeCompare(b);

/** Every tag the atlas uses, in alphabetical order, with how many boards carry it. */
export function atlasTags(atlas: AtlasIndex): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const board of atlas.boards) {
    for (const tag of board.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.keys()].sort(byText).map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
}

/** A section of the sidebar: a group of boards under one heading. */
export interface BoardSection {
  /** Stable across reloads, so a collapsed section stays collapsed. */
  key: string;
  title: string;
  /** Set for a section of one kind of board. */
  kind?: AtlasBoardKind;
  boards: AtlasBoard[];
}

/** The boards by kind, in `GROUPS` order; kinds with no board are left out. */
export function sectionsByKind(boards: readonly AtlasBoard[]): BoardSection[] {
  return GROUPS.map(({ kind }) => ({
    key: `kind:${kind}`,
    title: groupTitle(kind),
    kind,
    boards: boards.filter((b) => b.kind === kind),
  })).filter((s) => s.boards.length > 0);
}

/**
 * The boards by tag, tags in alphabetical order, then the boards with no tag. A board with two
 * tags is listed under both. Within a section, boards keep the order they were given.
 */
export function sectionsByTag(boards: readonly AtlasBoard[]): BoardSection[] {
  const tags = [...new Set(boards.flatMap((b) => b.tags))].sort(byText);
  const sections: BoardSection[] = tags.map((tag) => ({
    key: `tag:${tag}`,
    title: tag,
    boards: boards.filter((b) => b.tags.includes(tag)),
  }));
  const untagged = boards.filter((b) => b.tags.length === 0);
  if (untagged.length > 0)
    sections.push({ key: "untagged", title: t("section.untagged"), boards: untagged });
  return sections;
}

/** Claims by grounding, summed over every board that is not invalid. */
export function atlasGrounding(atlas: AtlasIndex): AtlasBoard["grounding"] {
  const total = { code: 0, spec: 0, none: 0 };
  for (const board of atlas.boards) {
    if (board.status === "invalid") continue;
    total.code += board.grounding.code;
    total.spec += board.grounding.spec;
    total.none += board.grounding.none;
  }
  return total;
}

/** The boards that need a look: invalid ones first, then stale ones, each in sidebar order. */
export function needsAttention(atlas: AtlasIndex): AtlasBoard[] {
  const ordered = orderedBoards(atlas);
  return [
    ...ordered.filter((b) => b.status === "invalid"),
    ...ordered.filter((b) => b.status === "stale"),
  ];
}

/** The boards before and after `slug` in its own group, in sidebar order. */
export function neighbours(
  atlas: AtlasIndex,
  slug: string,
): { prev: AtlasBoard | null; next: AtlasBoard | null; index: number; count: number } {
  const board = atlas.boards.find((b) => b.slug === slug);
  if (!board) return { prev: null, next: null, index: 0, count: 0 };
  const group = orderedBoards(atlas).filter((b) => b.kind === board.kind);
  const at = group.indexOf(board);
  return {
    prev: group[at - 1] ?? null,
    next: group[at + 1] ?? null,
    index: at + 1,
    count: group.length,
  };
}

/** Which kind of board wins when several define a ref: the screen's own board first. */
const DEFINING_PRIORITY: Record<AtlasBoardKind, number> = {
  screen: 0,
  api: 0,
  db: 0,
  batch: 0,
  overview: 1,
  flow: 2,
};

/**
 * The place that defines `ref`. A screen is usually defined both on its own board and on the
 * overview; the viewer follows screen to screen, so a screen board wins, then an overview, then
 * a flow, and boards of one kind are ordered by slug. Null when no board defines the ref.
 */
export function boardDefiningRef(atlas: AtlasIndex, ref: string): AtlasPlace | null {
  const entry = atlas.refs.find((r) => r.ref === ref);
  if (!entry) return null;
  const kindOf = (slug: string) => atlas.boards.find((b) => b.slug === slug)?.kind ?? "flow";
  const ranked = [...entry.definedIn].sort(
    (a, b) =>
      DEFINING_PRIORITY[kindOf(a.slug)] - DEFINING_PRIORITY[kindOf(b.slug)] ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  return ranked[0] ?? null;
}
