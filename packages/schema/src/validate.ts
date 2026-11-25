import type * as z from "zod";
import {
  type Board,
  type BoardNode,
  BoardShape,
  type BoardSource,
  ELEMENT_ROLES,
  GROUNDED_KINDS,
  LAYOUT_ORIGINS,
} from "./board.ts";
import { REF_EDGE_KINDS } from "./edges.ts";
import { endpointSlug } from "./endpoint.ts";
import { isBehaviourSource, isInteractiveElement, navigatesFromIds } from "./grounding.ts";
import { LIMITS, SCHEMA_VERSION } from "./limits.ts";
import { parseRef } from "./ref.ts";
import { familyOf, inheritStateFields, isCompactScreen, stateRoots } from "./states.ts";
import { columnSlug, findColumn } from "./table.ts";
import {
  MIN_WRAP_WIDTH,
  rowCells,
  SCREEN_WIDTH,
  SCREEN_WIDTH_BOUNDS,
  WIREFRAME_GAP,
  WIREFRAME_PADDING,
} from "./wireframe-size.ts";

export interface Issue {
  /** JSON path of the offending value, e.g. `nodes[3].label`; empty for the whole document. */
  path: string;
  message: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

type Path = ReadonlyArray<PropertyKey>;

export function formatPath(path: Path): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out;
}

const groundedKinds = new Set<string>(GROUNDED_KINDS);

/** What may back an action or a navigation, for messages. */
const BEHAVIOUR_SOURCES =
  "a quoted code source, a doc source, a figma source, a mockup with a path, or a link with a quote";

type Add = (path: Path, message: string) => void;

interface TreeItem {
  id: string;
  parentId?: string | undefined;
  index: number;
}

/**
 * Walks every parent chain of one tree (groups, or the elements of screens) and reports a
 * cycle once per cycle and a chain deeper than `maxDepth` once at the level that overflows.
 * `items` holds the members of the tree; a parentId outside it ends the chain.
 */
function checkParentChains(
  items: Map<string, TreeItem>,
  collection: "groups" | "nodes",
  noun: "group" | "element",
  maxDepth: number,
  add: Add,
): void {
  const reportedCycle = new Set<string>();
  for (const item of items.values()) {
    const chain: string[] = [item.id];
    const members = new Set(chain);
    let current = item;
    let cyclic = false;
    // Past one level beyond the limit the chain is too deep either way; stop walking there.
    while (current.parentId !== undefined && chain.length <= maxDepth + 1) {
      const parent = items.get(current.parentId);
      if (parent === undefined) break;
      if (members.has(parent.id)) {
        cyclic = true;
        const cycle = chain.slice(chain.indexOf(parent.id));
        if (!cycle.some((member) => reportedCycle.has(member))) {
          for (const member of cycle) reportedCycle.add(member);
          add(
            [collection, parent.index, "parentId"],
            `${noun} parentId chain forms a cycle: ${[...cycle, parent.id].map((g) => `\`${g}\``).join(" -> ")}`,
          );
        }
        break;
      }
      chain.push(parent.id);
      members.add(parent.id);
      current = parent;
    }
    if (!cyclic && chain.length === maxDepth + 1) {
      add(
        [collection, item.index, "parentId"],
        `${noun} \`${item.id}\` is nested ${chain.length} levels deep; at most ${maxDepth} levels are allowed`,
      );
    }
  }
}

/** Fields that belong to some node kinds only, with the kinds that may carry them. */
/** What a read or a write of a table may start at. */
const DATA_ACCESS_FROM: readonly string[] = ["endpoint", "step", "element", "job"];
/** What may put a job on its queue or start it. */
const ENQUEUE_FROM: readonly string[] = ["element", "step", "endpoint", "job"];
/** A cron field: digits, `*`, `/`, `,`, `-`, `?`, `L`, `W`, `#` and names of months and days. */
const CRON_FIELD = /^[0-9A-Za-z*/,?#-]+$/;

const NODE_FIELD_KINDS: ReadonlyArray<[keyof BoardNode, ReadonlyArray<string>]> = [
  ["parentId", ["element", "endpoint"]],
  ["method", ["endpoint"]],
  ["path", ["endpoint"]],
  ["pathPrefix", ["resource"]],
  ["columns", ["table"]],
  ["trigger", ["job"]],
  ["retry", ["job"]],
  ["timeout", ["job"]],
  ["role", ["element"]],
  ["direction", ["screen", "element"]],
  ["action", ["element"]],
  ["unresolved", ["element"]],
  ["layoutFrom", ["screen"]],
  ["platform", ["screen"]],
  ["stateOf", ["screen"]],
  ["width", ["screen", "element"]],
];

/**
 * Widths: a screen's width is within its platform's bounds and only on a screen with elements;
 * an element's width only inside a row; and the fixed widths of a row, with its gaps and the
 * least room of each flexible child, fit in the inner width the layout gives the row.
 */
function checkWidths(
  board: Board,
  indexById: ReadonlyMap<string, number>,
  rootOf: (screen: BoardNode) => BoardNode,
  add: Add,
): void {
  const byId = (nodeId: string | undefined) => {
    const index = nodeId === undefined ? undefined : indexById.get(nodeId);
    return index === undefined ? undefined : (board.nodes[index] as BoardNode);
  };
  const children = new Map<string, BoardNode[]>();
  board.nodes.forEach((node, i) => {
    if (node.kind !== "element" || node.parentId === undefined || indexById.get(node.id) !== i) {
      return;
    }
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  });

  board.nodes.forEach((node, i) => {
    if (node.width === undefined) return;
    if (node.kind === "screen") {
      const root = rootOf(node);
      if (root !== node) {
        // A different value from the root's is reported with the states.
        if (root.width === undefined) {
          add(
            ["nodes", i, "width"],
            `state screen \`${node.id}\` has width ${node.width} but its root \`${root.id}\` has none; a state takes the root's width, so set width on \`${root.id}\` and leave it off the state`,
          );
        }
        return;
      }
      if (node.stateOf !== undefined) return; // an invalid stateOf, reported with the states
      const platform = node.platform;
      const bounds = platform === undefined ? undefined : SCREEN_WIDTH_BOUNDS[platform];
      if (platform !== undefined && bounds !== undefined) {
        if (node.width < bounds.min || node.width > bounds.max) {
          add(
            ["nodes", i, "width"],
            `screen \`${node.id}\` has width ${node.width}; a ${platform} screen is ${bounds.min} to ${bounds.max} pixels wide`,
          );
        }
      }
      if (!children.has(node.id)) {
        add(
          ["nodes", i, "width"],
          `screen \`${node.id}\` has width but no elements; a screen without elements is drawn at a fixed overview size, so remove width`,
        );
      }
    } else if (node.kind === "element") {
      const parent = byId(node.parentId);
      if (parent !== undefined && parent.direction !== "row") {
        add(
          ["nodes", i, "width"],
          `element \`${node.id}\` has width but its parent \`${parent.id}\` stacks children in a column; width is only allowed on an element whose parent has direction row`,
        );
      }
    }
  });

  // Walk each screen's tree with the widths the layout gives it.
  const visited = new Set<string>();
  const walk = (container: BoardNode, inner: number) => {
    if (visited.has(container.id)) return;
    visited.add(container.id);
    const kids = children.get(container.id) ?? [];
    if (kids.length === 0) return;
    const childInner = (width: number) => Math.max(0, width - 2 * WIREFRAME_PADDING);
    if (container.direction !== "row") {
      for (const kid of kids) walk(kid, childInner(inner));
      return;
    }
    const fixed = kids.reduce((sum, kid) => sum + (kid.width ?? 0), 0);
    const flexible = kids.filter((kid) => kid.width === undefined).length;
    const needed = fixed + WIREFRAME_GAP * (kids.length - 1) + flexible * MIN_WRAP_WIDTH;
    if (fixed > 0 && needed > inner) {
      const index = indexById.get(container.id) as number;
      const parts = [`fixed widths ${fixed}`, `gaps ${WIREFRAME_GAP * (kids.length - 1)}`];
      if (flexible > 0) parts.push(`${flexible} flexible × ${MIN_WRAP_WIDTH}`);
      add(
        ["nodes", index],
        `row \`${container.id}\` needs ${needed} pixels (${parts.join(", ")}) but has ${round(inner)}; narrow the fixed widths or widen the screen`,
      );
    }
    const cells = rowCells(
      inner,
      kids.map((kid) => kid.width),
    );
    kids.forEach((kid, k) => {
      walk(kid, childInner(cells[k]?.width ?? 0));
    });
  };
  for (const node of board.nodes) {
    if (node.kind !== "screen" || byId(node.id) !== node) continue;
    const root = node.stateOf === undefined ? node : rootOf(node);
    const platform = node.platform ?? root.platform ?? "web";
    const width = node.width ?? root.width ?? SCREEN_WIDTH[platform];
    walk(node, width - 2 * WIREFRAME_PADDING);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function checkReferences(board: Board, ctx: z.RefinementCtx): void {
  const add: Add = (path, message) => ctx.addIssue({ code: "custom", path: [...path], message });

  const indexById = <T extends { id: string }>(items: T[], name: string) => {
    const map = new Map<string, number>();
    items.forEach((item, i) => {
      if (map.has(item.id)) {
        add([name, i, "id"], `duplicate ${name.slice(0, -1)} id \`${item.id}\``);
      } else {
        map.set(item.id, i);
      }
    });
    return map;
  };

  const groups = indexById(board.groups, "groups");
  const nodes = indexById(board.nodes, "nodes");
  indexById(board.edges, "edges");
  const sources = indexById(board.sources, "sources");
  const nodeById = (nodeId: string | undefined): BoardNode | undefined => {
    const index = nodeId === undefined ? undefined : nodes.get(nodeId);
    return index === undefined ? undefined : board.nodes[index];
  };
  const sourceById = (sourceId: string): BoardSource | undefined => {
    const index = sources.get(sourceId);
    return index === undefined ? undefined : board.sources[index];
  };
  const backsBehaviour = (sourceIds: string[]) =>
    sourceIds.some((sourceId) => {
      const source = sourceById(sourceId);
      return source !== undefined && isBehaviourSource(source);
    });
  /**
   * The sources a claim cited before a person changed it: they exist, and only a `manual` claim
   * has them, so a board that drops `manual` but keeps them does not pass for checked.
   */
  const checkPriorSources = (
    item: { id: string; manual?: true; priorSourceIds?: string[] },
    at: [string, number],
  ) => {
    if (item.priorSourceIds === undefined) return;
    if (!item.manual) {
      add(
        [...at, "priorSourceIds"],
        `\`${item.id}\` has priorSourceIds but is not manual; check its sources again and move them back to sourceIds, or keep it manual`,
      );
    }
    item.priorSourceIds.forEach((sourceId, j) => {
      if (!sources.has(sourceId)) {
        add(
          [...at, "priorSourceIds", j],
          `\`${item.id}\` lists prior source \`${sourceId}\`, which is not a source id`,
        );
      }
    });
  };

  // Groups: parent exists, no cycle, bounded depth.
  board.groups.forEach((group, i) => {
    if (group.parentId !== undefined && !groups.has(group.parentId)) {
      add(
        ["groups", i, "parentId"],
        `group \`${group.id}\` has parentId \`${group.parentId}\`, which is not a group id`,
      );
    }
  });
  const groupTree = new Map<string, TreeItem>();
  for (const [groupId, index] of groups) {
    groupTree.set(groupId, { id: groupId, parentId: board.groups[index]?.parentId, index });
  }
  checkParentChains(groupTree, "groups", "group", LIMITS.groupDepth, add);

  // Nodes: group exists, sources exist, grounded kinds cite quoted code sources.
  const quoteReported = new Set<number>();
  board.nodes.forEach((node, i) => {
    if (node.groupId !== undefined && !groups.has(node.groupId)) {
      add(
        ["nodes", i, "groupId"],
        `node \`${node.id}\` has groupId \`${node.groupId}\`, which is not a group id`,
      );
    }
    node.sourceIds.forEach((sourceId, j) => {
      const sourceIndex = sources.get(sourceId);
      if (sourceIndex === undefined) {
        add(
          ["nodes", i, "sourceIds", j],
          `node \`${node.id}\` cites source \`${sourceId}\`, which is not a source id`,
        );
        return;
      }
      const source = board.sources[sourceIndex] as BoardSource;
      if (
        groundedKinds.has(node.kind) &&
        source.kind === "code" &&
        (source.quote === undefined || source.quote.trim() === "") &&
        !quoteReported.has(sourceIndex)
      ) {
        quoteReported.add(sourceIndex);
        add(
          ["sources", sourceIndex, "quote"],
          `source \`${source.id}\` is cited by ${node.kind} node \`${node.id}\` but has no quote; copy the cited text from ${source.path}:${source.line} into quote`,
        );
      }
    });
    checkPriorSources(node, ["nodes", i]);
    if (groundedKinds.has(node.kind) && node.sourceIds.length === 0 && !node.manual) {
      add(
        ["nodes", i, "sourceIds"],
        `node \`${node.id}\` (kind \`${node.kind}\`) has no sourceIds; cite at least one source, or make it a \`question\` or \`note\``,
      );
    }
    for (const [field, kinds] of NODE_FIELD_KINDS) {
      if (node[field] !== undefined && !kinds.includes(node.kind)) {
        add(
          ["nodes", i, field],
          `${field} is only allowed on ${kinds.map((k) => `\`${k}\``).join(" and ")} nodes, not on \`${node.kind}\` node \`${node.id}\``,
        );
      }
    }
    if (node.groupId !== undefined && node.kind === "element") {
      add(
        ["nodes", i, "groupId"],
        `element node \`${node.id}\` must not have a groupId; it sits inside its screen's frame`,
      );
    } else if (
      node.groupId !== undefined &&
      node.kind === "screen" &&
      !isCompactScreen(board, node)
    ) {
      add(
        ["nodes", i, "groupId"],
        `screen node \`${node.id}\` must not have a groupId: it has elements or states, so it is drawn as a frame, and frames cannot be nested in group frames; only a screen with neither may sit in a group`,
      );
    }
  });

  // States: stateOf names another screen that is not a state; a state has no ref, and its
  // platform, layout origin and width, when given, are the root's.
  const roots = stateRoots(board);
  const firstNodeById = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!firstNodeById.has(node.id)) firstNodeById.set(node.id, node);
  const rootOf = (screen: BoardNode): BoardNode => nodeById(roots.get(screen.id)) ?? screen;
  const familyIdOf = (nodeId: string) => familyOf(nodeId, firstNodeById, roots);
  board.nodes.forEach((node, i) => {
    if (node.kind !== "screen" || node.stateOf === undefined) return;
    const target = nodeById(node.stateOf);
    if (node.stateOf === node.id) {
      add(["nodes", i, "stateOf"], `screen \`${node.id}\` cannot be a state of itself`);
    } else if (target === undefined) {
      add(
        ["nodes", i, "stateOf"],
        `screen \`${node.id}\` has stateOf \`${node.stateOf}\`, which is not a node id`,
      );
    } else if (target.kind !== "screen") {
      add(
        ["nodes", i, "stateOf"],
        `screen \`${node.id}\` has stateOf \`${target.id}\`, a \`${target.kind}\` node; stateOf names the screen this is a state of`,
      );
    } else if (target.stateOf !== undefined) {
      add(
        ["nodes", i, "stateOf"],
        `screen \`${node.id}\` has stateOf \`${target.id}\`, which is itself a state of \`${target.stateOf}\`; states do not nest, so name the root screen`,
      );
    }
    if (node.ref !== undefined) {
      add(
        ["nodes", i, "ref"],
        `state screen \`${node.id}\` must not have a ref; it is a state of \`${node.stateOf}\`, defines no atlas ref, and its elements' refs extend the root's ref`,
      );
    }
    const root = roots.has(node.id) ? rootOf(node) : undefined;
    if (root === undefined) return;
    for (const field of ["platform", "layoutFrom", "width"] as const) {
      if (node[field] !== undefined && root[field] !== undefined && node[field] !== root[field]) {
        add(
          ["nodes", i, field],
          `state screen \`${node.id}\` has ${field} \`${node[field]}\` but its root \`${root.id}\` has \`${root[field]}\`; omit it to inherit the root's`,
        );
      }
    }
  });

  // Screens: ref, platform and layout origin are required and agree with each other. A state
  // takes them from its root.
  board.nodes.forEach((node, i) => {
    if (node.kind !== "screen") return;
    if (roots.has(node.id)) {
      const root = rootOf(node);
      if (
        (node.layoutFrom ?? root.layoutFrom) === "code" &&
        !node.manual &&
        !node.sourceIds.some((sourceId) => sourceById(sourceId)?.kind === "code")
      ) {
        add(
          ["nodes", i, "sourceIds"],
          `state screen \`${node.id}\` is drawn from code but cites no code source; cite the line that renders this state`,
        );
      }
      return;
    }
    if (node.stateOf !== undefined) return; // an invalid stateOf, reported above
    if (node.layoutFrom === undefined) {
      add(
        ["nodes", i, "layoutFrom"],
        `screen node \`${node.id}\` needs layoutFrom: ${LAYOUT_ORIGINS.join(", ")}`,
      );
    } else if (
      node.layoutFrom === "code" &&
      !node.manual &&
      !node.sourceIds.some((sourceId) => sourceById(sourceId)?.kind === "code")
    ) {
      add(
        ["nodes", i, "layoutFrom"],
        `screen node \`${node.id}\` has layoutFrom code but cites no code source; cite the route or component, or use figma, screenshot, mockup or doc`,
      );
    }
    if (node.platform === undefined) {
      add(["nodes", i, "platform"], `screen node \`${node.id}\` needs platform: web or mobile`);
    }
    if (node.ref === undefined) {
      add(["nodes", i, "ref"], `screen node \`${node.id}\` needs a ref such as \`web:cart\``);
      return;
    }
    const parsed = parseRef(node.ref);
    if (parsed === null) return; // reported by the structural check
    if (!("platform" in parsed)) {
      add(
        ["nodes", i, "ref"],
        `screen node \`${node.id}\` has ref \`${node.ref}\`; a screen ref starts with web: or mobile:`,
      );
    } else if (parsed.element !== undefined) {
      add(
        ["nodes", i, "ref"],
        `screen node \`${node.id}\` has element ref \`${node.ref}\`; a screen ref has no \`/<element>\` part`,
      );
    } else if (node.platform !== undefined && parsed.platform !== node.platform) {
      add(
        ["nodes", i, "platform"],
        `screen node \`${node.id}\` has platform \`${node.platform}\` but ref \`${node.ref}\``,
      );
    }
  });

  // Elements: parent is a screen or element, the tree is acyclic and bounded, each element
  // belongs to one screen, and its ref extends that screen's ref.
  const elementTree = new Map<string, TreeItem>();
  board.nodes.forEach((node, i) => {
    if (node.kind !== "element" || nodes.get(node.id) !== i) return;
    elementTree.set(node.id, { id: node.id, parentId: node.parentId, index: i });
    if (node.role === undefined) {
      add(
        ["nodes", i, "role"],
        `element node \`${node.id}\` needs a role: ${ELEMENT_ROLES.join(", ")}`,
      );
    }
    if (node.parentId === undefined) {
      add(
        ["nodes", i, "parentId"],
        `element node \`${node.id}\` needs a parentId naming its screen or containing element`,
      );
      return;
    }
    const parent = nodeById(node.parentId);
    if (parent === undefined || (parent.kind !== "screen" && parent.kind !== "element")) {
      add(
        ["nodes", i, "parentId"],
        `element \`${node.id}\` has parentId \`${node.parentId}\`, which is not a screen or element node`,
      );
    }
  });
  checkParentChains(elementTree, "nodes", "element", LIMITS.elementDepth, add);

  const screenOf = (element: BoardNode): BoardNode | undefined => {
    const seen = new Set<string>();
    let current: BoardNode | undefined = element;
    while (current?.kind === "element" && !seen.has(current.id)) {
      seen.add(current.id);
      current = nodeById(current.parentId);
    }
    return current?.kind === "screen" ? current : undefined;
  };

  // Navigates edges whose `from` is an element make that element interactive.
  const navigatesFrom = navigatesFromIds(board.edges);

  board.nodes.forEach((node, i) => {
    if (node.kind !== "element") return;
    const owner = screenOf(node);
    const root = owner === undefined ? undefined : rootOf(owner);
    if (node.ref !== undefined && root?.ref !== undefined) {
      const parsed = parseRef(node.ref);
      if (
        parsed !== null &&
        (!("platform" in parsed) || parsed.element === undefined || parsed.screenRef !== root.ref)
      ) {
        add(
          ["nodes", i, "ref"],
          owner !== root
            ? `element \`${node.id}\` belongs to state \`${owner?.id}\` of screen \`${root.ref}\`, so its ref must start with \`${root.ref}/\``
            : `element \`${node.id}\` belongs to screen \`${root.ref}\`, so its ref must start with \`${root.ref}/\``,
        );
      }
    }
    const screen =
      owner === undefined
        ? undefined
        : { ...owner, layoutFrom: owner.layoutFrom ?? root?.layoutFrom };
    if (screen?.layoutFrom === "doc") {
      add(
        ["nodes", i, "parentId"],
        `element \`${node.id}\` belongs to screen \`${screen.id}\`, whose layoutFrom is doc; a screen described only in a document has no layout to draw, so it has no elements`,
      );
      return;
    }
    if (isInteractiveElement(node, navigatesFrom)) {
      if (node.unresolved !== undefined || node.manual) return;
      if (node.action === undefined) {
        add(
          ["nodes", i, "action"],
          `interactive element \`${node.id}\` needs an action backed by ${BEHAVIOUR_SOURCES}, or unresolved naming who must answer`,
        );
      } else if (!backsBehaviour(node.sourceIds)) {
        add(
          ["nodes", i, "sourceIds"],
          `interactive element \`${node.id}\` has an action but cites no source that can back it; cite ${BEHAVIOUR_SOURCES} (a mockup without a path or a link without a quote does not locate the behaviour), or set unresolved`,
        );
      }
      return;
    }
    const drawnFromDesign =
      screen?.layoutFrom === "figma" ||
      screen?.layoutFrom === "screenshot" ||
      screen?.layoutFrom === "mockup";
    if (node.sourceIds.length === 0 && !drawnFromDesign && !node.manual) {
      add(
        ["nodes", i, "sourceIds"],
        `element \`${node.id}\` cites no source and its screen's layout comes from code; cite where it is rendered`,
      );
    }
  });

  checkWidths(board, nodes, rootOf, add);

  // Refs: a board defines each ref at most once (on a screen or an element).
  const definedRefs = new Set<string>();
  board.nodes.forEach((node, i) => {
    if ((node.kind !== "screen" && node.kind !== "element") || node.ref === undefined) return;
    if (definedRefs.has(node.ref)) {
      add(
        ["nodes", i, "ref"],
        `ref \`${node.ref}\` is defined more than once on this board; another screen or element already has it`,
      );
    }
    definedRefs.add(node.ref);
  });

  /** Roots that have at least one state. */
  const families = new Set(roots.values());
  /** A screen whose stateOf is already reported; edges to it are not checked again. */
  const hasBrokenStateOf = (screen: BoardNode | undefined) =>
    screen?.stateOf !== undefined && !roots.has(screen.id);

  /**
   * A transition that ends at a screen changes the state of that screen: it starts at the
   * screen, one of its states or one of their elements, and cites what triggers it.
   */
  const checkScreenTransition = (edge: Board["edges"][number], i: number) => {
    const to = nodeById(edge.to);
    if (to?.kind !== "screen") return;
    const from = nodeById(edge.from);
    if (from !== undefined) {
      if (from.kind !== "screen" && from.kind !== "element") {
        add(
          ["edges", i, "from"],
          `transition edge \`${edge.id}\` ends at screen \`${to.id}\` but starts at \`${from.kind}\` node \`${from.id}\`; it must start at a screen state or one of its elements`,
        );
      } else if (
        !hasBrokenStateOf(to) &&
        !hasBrokenStateOf(from.kind === "element" ? screenOf(from) : from) &&
        familyIdOf(from.id) !== familyIdOf(to.id)
      ) {
        add(
          ["edges", i, "to"],
          `transition edge \`${edge.id}\` goes from \`${from.id}\` to screen \`${to.id}\`, which is not that screen or one of its states; use navigates to open another screen, or set stateOf on \`${to.id}\``,
        );
      }
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `transition edge \`${edge.id}\` changes screen state but cites no source that can back it; cite the line that sets the state, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  };

  /** A `toRef` is allowed on the edge kinds that point across boards, in their namespaces. */
  const checkToRef = (edge: Board["edges"][number], i: number) => {
    const rule = REF_EDGE_KINDS[edge.kind];
    const allowed = Object.entries(REF_EDGE_KINDS).map(([kind]) => kind);
    if (rule === undefined) {
      add(
        ["edges", i, "toRef"],
        `toRef is only allowed on ${allowed.join(", ")} edges, not on \`${edge.kind}\``,
      );
      return;
    }
    const parsed = parseRef(edge.toRef as string);
    if (parsed === null) return; // reported by the structural check
    const child = "platform" in parsed ? parsed.element !== undefined : parsed.child !== undefined;
    if (rule.level === "any") {
      if (!rule.namespaces.includes(parsed.namespace)) {
        add(
          ["edges", i, "toRef"],
          `edge \`${edge.id}\` (${edge.kind}) toRef \`${edge.toRef}\` is in namespace ${parsed.namespace}; ${edge.kind} targets a ${rule.namespaces.join(" or ")} ref`,
        );
      }
      return;
    }
    const what =
      edge.kind === "navigates"
        ? "a screen ref"
        : edge.kind === "calls"
          ? "an endpoint ref (api:<resource>/<endpoint>)"
          : "a ref";
    if (!rule.namespaces.includes(parsed.namespace)) {
      add(
        ["edges", i, "toRef"],
        `edge \`${edge.id}\` (${edge.kind}) toRef \`${edge.toRef}\` is in namespace ${parsed.namespace}; ${edge.kind} targets ${what}`,
      );
    } else if (child !== (rule.level === "child")) {
      add(
        ["edges", i, "toRef"],
        edge.kind === "navigates"
          ? `edge \`${edge.id}\` toRef \`${edge.toRef}\` names an element; navigates targets a screen ref`
          : `edge \`${edge.id}\` (${edge.kind}) toRef \`${edge.toRef}\` must name ${what}`,
      );
    }
  };

  /** A call goes from a control or a step to an endpoint, and cites the line that calls it. */
  const checkCall = (edge: Board["edges"][number], i: number) => {
    const from = nodeById(edge.from);
    if (from !== undefined && from.kind !== "element" && from.kind !== "step") {
      add(
        ["edges", i, "from"],
        `calls edge \`${edge.id}\` starts at \`${from.kind}\` node \`${from.id}\`; it must start at an element or a step`,
      );
    }
    const to = nodeById(edge.to);
    if (to !== undefined && to.kind !== "endpoint") {
      add(
        ["edges", i, "to"],
        `calls edge \`${edge.id}\` ends at \`${to.kind}\` node \`${to.id}\`; it must end at an endpoint, or use toRef for one on another board`,
      );
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `calls edge \`${edge.id}\` cites no source that can back the call; cite the line that calls the endpoint, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  };

  /** A foreign key goes from a table to a table, from a column of one to a column of the other. */
  const checkReference = (edge: Board["edges"][number], i: number) => {
    const from = nodeById(edge.from);
    if (from !== undefined && from.kind !== "table") {
      add(
        ["edges", i, "from"],
        `references edge \`${edge.id}\` starts at \`${from.kind}\` node \`${from.id}\`; it must start at a table`,
      );
    }
    const to = nodeById(edge.to);
    if (to !== undefined && to.kind !== "table") {
      add(
        ["edges", i, "to"],
        `references edge \`${edge.id}\` ends at \`${to.kind}\` node \`${to.id}\`; it must end at a table, or use toRef for one on another board`,
      );
    }
    if (edge.fromColumn === undefined) {
      add(
        ["edges", i, "fromColumn"],
        `references edge \`${edge.id}\` needs fromColumn, the column that holds the key`,
      );
    } else if (from?.kind === "table" && findColumn(from, edge.fromColumn) === undefined) {
      add(
        ["edges", i, "fromColumn"],
        `references edge \`${edge.id}\` fromColumn \`${edge.fromColumn}\` is not a column of table \`${from.id}\``,
      );
    }
    if (
      edge.toColumn !== undefined &&
      to?.kind === "table" &&
      findColumn(to, edge.toColumn) === undefined
    ) {
      add(
        ["edges", i, "toColumn"],
        `references edge \`${edge.id}\` toColumn \`${edge.toColumn}\` is not a column of table \`${to.id}\``,
      );
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `references edge \`${edge.id}\` cites no source that can back the foreign key; cite the line that declares it, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  };

  /** A read or a write goes from what runs the query to a table, and cites the query. */
  const checkDataAccess = (edge: Board["edges"][number], i: number) => {
    const from = nodeById(edge.from);
    if (from !== undefined && !DATA_ACCESS_FROM.includes(from.kind)) {
      add(
        ["edges", i, "from"],
        `${edge.kind} edge \`${edge.id}\` starts at \`${from.kind}\` node \`${from.id}\`; it must start at ${DATA_ACCESS_FROM.map((k) => `a ${k}`).join(", ")}`,
      );
    }
    const to = nodeById(edge.to);
    if (to !== undefined && to.kind !== "table") {
      add(
        ["edges", i, "to"],
        `${edge.kind} edge \`${edge.id}\` ends at \`${to.kind}\` node \`${to.id}\`; it must end at a table, or use toRef for a table or a column on another board`,
      );
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `${edge.kind} edge \`${edge.id}\` cites no source that can back it; cite the line that runs the query, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  };

  /** An enqueue puts a job on its queue, or starts it, and cites the line that does it. */
  const checkEnqueue = (edge: Board["edges"][number], i: number) => {
    const from = nodeById(edge.from);
    if (from !== undefined && !ENQUEUE_FROM.includes(from.kind)) {
      add(
        ["edges", i, "from"],
        `enqueues edge \`${edge.id}\` starts at \`${from.kind}\` node \`${from.id}\`; it must start at an element, a step, an endpoint or a job`,
      );
    }
    const to = nodeById(edge.to);
    if (to !== undefined && to.kind !== "job") {
      add(
        ["edges", i, "to"],
        `enqueues edge \`${edge.id}\` ends at \`${to.kind}\` node \`${to.id}\`; it must end at a job, or use toRef for one on another board`,
      );
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `enqueues edge \`${edge.id}\` cites no source that can back it; cite the line that enqueues the job or emits its event, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  };

  // Jobs: a job defines a batch ref and has a trigger with the field its type needs.
  board.nodes.forEach((node, i) => {
    if (node.kind !== "job") return;
    const parsed = node.ref === undefined ? null : parseRef(node.ref);
    if (node.ref === undefined) {
      add(
        ["nodes", i, "ref"],
        `job node \`${node.id}\` needs a ref such as \`batch:send-receipt\``,
      );
    } else if (
      parsed !== null &&
      (parsed.namespace !== "batch" || "platform" in parsed || parsed.child !== undefined)
    ) {
      add(
        ["nodes", i, "ref"],
        `job node \`${node.id}\` has ref \`${node.ref}\`; a job ref is \`batch:<job>\`, with no second part`,
      );
    }
    const trigger = node.trigger;
    if (trigger === undefined) {
      add(
        ["nodes", i, "trigger"],
        `job \`${node.id}\` needs a trigger: cron, queue, event or manual`,
      );
      return;
    }
    const needs = { cron: "schedule", queue: "queue", event: "event", manual: undefined } as const;
    const field = needs[trigger.type];
    if (field !== undefined && trigger[field] === undefined) {
      add(
        ["nodes", i, "trigger", field],
        `job \`${node.id}\` has a ${trigger.type} trigger, so it needs trigger.${field}`,
      );
    }
    for (const other of ["schedule", "queue", "event"] as const) {
      if (other !== field && trigger[other] !== undefined) {
        add(
          ["nodes", i, "trigger", other],
          `job \`${node.id}\` has a ${trigger.type} trigger; trigger.${other} belongs to a ${other === "schedule" ? "cron" : other} trigger`,
        );
      }
    }
    if (trigger.type === "cron" && trigger.schedule !== undefined) {
      const fields = trigger.schedule.trim().split(/\s+/);
      if (fields.length < 5 || fields.length > 6 || !fields.every((f) => CRON_FIELD.test(f))) {
        add(
          ["nodes", i, "trigger", "schedule"],
          `job \`${node.id}\` schedule \`${trigger.schedule}\` is not a cron expression: 5 or 6 fields of digits, *, /, -, and commas`,
        );
      }
    }
  });

  // Tables: a table defines a db ref; its columns have distinct slugs and cite real sources.
  board.nodes.forEach((node, i) => {
    if (node.kind !== "table") return;
    const parsed = node.ref === undefined ? null : parseRef(node.ref);
    if (node.ref === undefined) {
      add(["nodes", i, "ref"], `table node \`${node.id}\` needs a ref such as \`db:orders\``);
    } else if (
      parsed !== null &&
      (parsed.namespace !== "db" || "platform" in parsed || parsed.child !== undefined)
    ) {
      add(
        ["nodes", i, "ref"],
        `table node \`${node.id}\` has ref \`${node.ref}\`; a table ref is \`db:<table>\``,
      );
    }
    const slugs = new Map<string, string>();
    (node.columns ?? []).forEach((column, j) => {
      const slug = columnSlug(column.name);
      if (slug === null) {
        add(
          ["nodes", i, "columns", j, "name"],
          `column \`${column.name}\` of table \`${node.id}\` gives no ref slug of at most 60 characters`,
        );
        return;
      }
      const twin = slugs.get(slug);
      if (twin !== undefined) {
        add(
          ["nodes", i, "columns", j, "name"],
          `columns \`${twin}\` and \`${column.name}\` of table \`${node.id}\` both give the ref slug \`${slug}\`; a column is named once`,
        );
      }
      slugs.set(slug, column.name);
      (column.sourceIds ?? []).forEach((sourceId, k) => {
        if (!sources.has(sourceId)) {
          add(
            ["nodes", i, "columns", j, "sourceIds", k],
            `column \`${column.name}\` of table \`${node.id}\` cites source \`${sourceId}\`, which is not a source id`,
          );
        }
      });
    });
  });

  // API: a resource defines an api ref; each endpoint sits in a resource, has a method and a
  // path, extends the resource's ref, and no two endpoints of a resource share method and path.
  const routes = new Map<string, string>();
  board.nodes.forEach((node, i) => {
    if (node.kind === "resource") {
      const parsed = node.ref === undefined ? null : parseRef(node.ref);
      if (node.ref === undefined) {
        add(["nodes", i, "ref"], `resource node \`${node.id}\` needs a ref such as \`api:orders\``);
      } else if (
        parsed !== null &&
        (parsed.namespace !== "api" || "platform" in parsed || parsed.child !== undefined)
      ) {
        add(
          ["nodes", i, "ref"],
          `resource node \`${node.id}\` has ref \`${node.ref}\`; a resource ref is \`api:<resource>\``,
        );
      }
      return;
    }
    if (node.kind !== "endpoint") return;
    const parent = nodeById(node.parentId);
    if (node.parentId === undefined || parent?.kind !== "resource") {
      add(
        ["nodes", i, "parentId"],
        `endpoint \`${node.id}\` needs parentId naming a resource node on this board`,
      );
    }
    if (node.method === undefined) {
      add(
        ["nodes", i, "method"],
        `endpoint \`${node.id}\` needs a method: GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS`,
      );
    }
    if (node.path === undefined) {
      add(
        ["nodes", i, "path"],
        `endpoint \`${node.id}\` needs the path its route declares, such as \`/orders/:id\``,
      );
    } else if (!node.path.startsWith("/")) {
      add(["nodes", i, "path"], `endpoint \`${node.id}\` path \`${node.path}\` must start with /`);
    }
    if (node.method !== undefined && node.path !== undefined && parent?.kind === "resource") {
      const key = `${parent.id} ${node.method} ${node.path}`;
      const twin = routes.get(key);
      if (twin !== undefined) {
        add(
          ["nodes", i, "path"],
          `endpoints \`${twin}\` and \`${node.id}\` are both ${node.method} ${node.path}; an endpoint is drawn once`,
        );
      } else {
        routes.set(key, node.id);
      }
    }
    if (node.ref === undefined) {
      add(["nodes", i, "ref"], `endpoint \`${node.id}\` needs a ref such as \`api:orders/get-id\``);
      return;
    }
    const parsed = parseRef(node.ref);
    if (parsed === null || parent?.kind !== "resource" || parent.ref === undefined) return;
    if ("platform" in parsed || parsed.child === undefined || parsed.rootRef !== parent.ref) {
      add(
        ["nodes", i, "ref"],
        `endpoint \`${node.id}\` belongs to resource \`${parent.ref}\`, so its ref must start with \`${parent.ref}/\``,
      );
      return;
    }
    if (node.method !== undefined && node.path !== undefined) {
      const resource = parent.ref.slice("api:".length);
      if (endpointSlug(node.method, node.path, resource, parent.pathPrefix) === null) {
        add(
          ["nodes", i, "path"],
          `endpoint \`${node.id}\` path is too long to name its ref; split the resource or shorten the path`,
        );
      }
    }
  });

  // Edges: endpoints are nodes, exactly one target, sources exist, navigates is grounded.
  board.edges.forEach((edge, i) => {
    checkPriorSources(edge, ["edges", i]);
    if (!nodes.has(edge.from)) {
      add(
        ["edges", i, "from"],
        `edge \`${edge.id}\` from \`${edge.from}\`, which is not a node id`,
      );
    }
    if (edge.to !== undefined && !nodes.has(edge.to)) {
      add(["edges", i, "to"], `edge \`${edge.id}\` to \`${edge.to}\`, which is not a node id`);
    }
    if ((edge.to === undefined) === (edge.toRef === undefined)) {
      add(
        ["edges", i, "to"],
        edge.to === undefined
          ? `edge \`${edge.id}\` needs \`to\` (a node id) or, for navigates, \`toRef\` (a screen ref)`
          : `edge \`${edge.id}\` has both \`to\` and \`toRef\`; keep one`,
      );
    }
    for (const field of ["fromColumn", "toColumn", "cardinality"] as const) {
      if (edge[field] !== undefined && edge.kind !== "references") {
        add(
          ["edges", i, field],
          `${field} is only allowed on references edges, not on \`${edge.kind}\` edge \`${edge.id}\``,
        );
      }
    }
    if (edge.toRef !== undefined) checkToRef(edge, i);
    edge.sourceIds.forEach((sourceId, j) => {
      if (!sources.has(sourceId)) {
        add(
          ["edges", i, "sourceIds", j],
          `edge \`${edge.id}\` cites source \`${sourceId}\`, which is not a source id`,
        );
      }
    });
    if (edge.kind === "transition") {
      checkScreenTransition(edge, i);
      return;
    }
    if (edge.kind === "calls") {
      checkCall(edge, i);
      return;
    }
    if (edge.kind === "references") {
      checkReference(edge, i);
      return;
    }
    if (edge.kind === "reads" || edge.kind === "writes") {
      checkDataAccess(edge, i);
      return;
    }
    if (edge.kind === "enqueues") {
      checkEnqueue(edge, i);
      return;
    }
    if (edge.kind !== "navigates") return;
    const from = nodeById(edge.from);
    if (from !== undefined && from.kind !== "element" && from.kind !== "screen") {
      add(
        ["edges", i, "from"],
        `navigates edge \`${edge.id}\` starts at \`${from.kind}\` node \`${from.id}\`; it must start at a screen or element`,
      );
    }
    const to = nodeById(edge.to);
    if (to !== undefined && to.kind !== "screen") {
      add(
        ["edges", i, "to"],
        `navigates edge \`${edge.id}\` ends at \`${to.kind}\` node \`${to.id}\`; it must end at a screen, or use toRef for a screen on another board`,
      );
    }
    if (to?.kind === "screen" && (roots.has(to.id) || families.has(to.id))) {
      const fromFamily = from === undefined ? undefined : familyIdOf(from.id);
      if (roots.has(to.id) || fromFamily === familyIdOf(to.id)) {
        add(
          ["edges", i, "kind"],
          `navigates edge \`${edge.id}\` ends at \`${to.id}\`, ${roots.has(to.id) ? "a state" : "the root"} of screen \`${rootOf(to).id}\`${fromFamily === familyIdOf(to.id) ? ", from within that screen" : ""}; a change of state on the same screen is a transition edge, and navigates opens another screen`,
        );
      }
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `navigates edge \`${edge.id}\` cites no source that can back a navigation; cite the line that navigates, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  });

  // Sources: endLine not before line.
  board.sources.forEach((source, i) => {
    if (
      (source.kind === "code" || source.kind === "doc") &&
      source.endLine !== undefined &&
      source.endLine < source.line
    ) {
      add(
        ["sources", i, "endLine"],
        `source \`${source.id}\` has endLine ${source.endLine} before line ${source.line}`,
      );
    }
  });
}

/** Full board schema: structure plus cross-reference and grounding checks. */
export const BoardSchema = BoardShape.superRefine(checkReferences).transform(inheritStateFields);

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_big":
      if (issue.origin === "string") return `is longer than ${issue.maximum} characters`;
      if (issue.origin === "array") return `has more than ${issue.maximum} items`;
      return `must be at most ${issue.maximum}`;
    case "too_small":
      if (issue.origin === "string") return "must not be empty";
      if (issue.origin === "array") return `needs at least ${issue.minimum} item(s)`;
      return `must be at least ${issue.minimum}`;
    case "invalid_type":
      return `expected ${issue.expected}`;
    case "invalid_value":
      return `must be one of: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "invalid_union":
      if ("discriminator" in issue && "options" in issue && Array.isArray(issue.options)) {
        const options = issue.options.filter((o: unknown) => o !== undefined && o !== null);
        return `must be one of: ${options.map((v: unknown) => JSON.stringify(v)).join(", ")}`;
      }
      return issue.message;
    case "invalid_format":
      return issue.format === "datetime"
        ? "must be an ISO 8601 date-time with offset"
        : issue.message;
    default:
      return issue.message;
  }
}

/** A zod issue as an `Issue`: its path and a stable message. */
export function toIssue(issue: z.core.$ZodIssue): Issue {
  const path = formatPath(issue.path);
  if (issue.code === "custom") return { path, message: issue.message };
  const where = path === "" ? "board" : path;
  return { path, message: `${where} ${describeIssue(issue)}` };
}

/** Validates an unknown value as a board. Issues carry stable, path-precise messages. */
export function parseBoard(input: unknown): Result<Board, Issue[]> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: [{ path: "", message: "a board must be a JSON object" }] };
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: [
        {
          path: "schemaVersion",
          message:
            version === undefined
              ? `schemaVersion is missing; set it to ${SCHEMA_VERSION}`
              : `unsupported schemaVersion ${JSON.stringify(version)}; this groundboard reads version ${SCHEMA_VERSION}`,
        },
      ],
    };
  }
  const result = BoardSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map(toIssue) };
}
