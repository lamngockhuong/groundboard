import {
  type Board,
  type BoardEdge,
  type BoardFragment,
  type MessageType,
  messageOrder,
  operandChain,
} from "@groundboard/schema";
import { measureText, wrapText } from "./measure.ts";
import {
  FONT_SIZE,
  MAX_TEXT_WIDTH,
  NODE_SHAPES,
  nodeText,
  SMALL_FONT_SIZE,
  shapeSize,
} from "./text.ts";
import type {
  LaidOutBoard,
  LaidOutEdge,
  LaidOutNode,
  LaidOutSequenceFragment,
  LaidOutText,
  Point,
} from "./types.ts";

/**
 * A sequence board is laid out here, not by ELK: its participants in a row of columns in the
 * order of `nodes`, a lifeline down from each, its messages one per row in the order of `edges`,
 * and each fragment a frame around the rows of its messages.
 *
 * Invariants the tests hold the layout to: column centres rise left to right, far enough apart
 * that every message label fits between the two columns it joins; message rows go strictly
 * down in message order; a fragment's frame contains the frames of the fragments inside it; and
 * no two boxes of text (a participant, a message label, a fragment's tag, label or guard)
 * overlap. Every fragment header and every divider between operands takes a band of rows of its
 * own, so no text shares a band with a message label.
 */

/** Room around the whole diagram. */
const PAD = 20;
const HEAD_PAD_X = 16;
const HEAD_PAD_Y = 10;
const MIN_HEAD_WIDTH = 100;
/** Room the renderer keeps at the left of a person's box for its figure. */
const PERSON_FIGURE = 24;
/** Space between the label of a participant and its category under it. */
const CAPTION_GAP = 2;
/** Least space between the boxes of two neighbouring participants. */
const COLUMN_GAP = 40;
/** Space each side of a message label, between it and the columns it joins. */
const LABEL_PAD = 12;
/** How far a message to itself reaches right of its column, and how tall its loop is. */
const SELF_LOOP_WIDTH = 36;
const SELF_LOOP_HEIGHT = 24;
/** Between the participants' boxes and the first row. */
const TOP_GAP = 24;
/** Between a message label and its line, and between a line and the next row. */
const LABEL_GAP = 4;
const ROW_GAP = 18;
/** How far a frame reaches beyond the columns its messages touch, and more per frame inside it. */
const FRAGMENT_PAD = 14;
const NEST_INSET = 10;
const TAG_PAD_X = 6;
const TAG_PAD_Y = 2;
/** Space between the parts of a fragment header (tag, label, guard), and around a header band. */
const HEADER_GAP = 6;
const BAND_PAD = 4;
/** Below the last row of a fragment, and between a closed fragment and the next row. */
const FRAGMENT_BOTTOM = 8;
const AFTER_FRAGMENT = 6;
/** Below the last row, where the lifelines end. */
const BOTTOM_GAP = 24;
/** Between the diagram and the column of questions and notes, and between two of them. */
const SIDE_GAP = 40;
const SIDE_SPACING = 16;

const round = (n: number) => Math.round(n * 100) / 100;

/** The text a message is drawn with: its number, its label, and `(async)` for an async one. */
export function messageText(
  number: number,
  edge: Pick<BoardEdge, "label" | "messageType">,
): string {
  const label = edge.label?.trim() ?? "";
  const suffix = edge.messageType === "async" ? " (async)" : "";
  return wrapText(`${number}. ${label}${suffix}`.trim(), MAX_TEXT_WIDTH, SMALL_FONT_SIZE);
}

const textBox = (text: string, fontSize: number, x: number, y: number): LaidOutText => {
  const size = measureText(text, fontSize);
  return { text, fontSize, x: round(x), y: round(y), width: size.width, height: size.height };
};

interface Column {
  id: string;
  index: number;
  width: number;
  height: number;
  label: string;
  labelSize: { width: number; height: number };
  caption: string;
  captionSize: { width: number; height: number };
}

/** Lays out a validated sequence board. The same board always gives the same result. */
export function layoutSequence(board: Board): LaidOutBoard {
  const fragments = board.fragments ?? [];
  const participants = board.nodes.filter((n) => n.kind === "participant");
  const columnOf = new Map(participants.map((p, i) => [p.id, i]));

  // Columns: each box as wide as its label (wrapped) and its category, all as tall as the tallest.
  const columns: Column[] = participants.map((p, index) => {
    const label = nodeText(p);
    const caption = p.category ?? "";
    const labelSize = measureText(label, FONT_SIZE);
    const captionSize = measureText(caption, SMALL_FONT_SIZE);
    return {
      id: p.id,
      index,
      width:
        Math.max(MIN_HEAD_WIDTH, Math.max(labelSize.width, captionSize.width) + 2 * HEAD_PAD_X) +
        (p.category === "person" ? PERSON_FIGURE : 0),
      height: labelSize.height + CAPTION_GAP + captionSize.height + 2 * HEAD_PAD_Y,
      label,
      labelSize,
      caption,
      captionSize,
    };
  });
  const headHeight = Math.max(0, ...columns.map((c) => c.height));

  const messages = messageOrder(board.edges);
  const texts = messages.map((m, k) => messageText(k + 1, m));
  const sizes = texts.map((t) => measureText(t, SMALL_FONT_SIZE));

  // Column centres, smallest that meet every constraint, swept left to right: each constraint
  // is put on its rightmost column, so earlier columns are already final.
  const needs: Array<Array<{ from: number; gap: number }>> = columns.map(() => []);
  messages.forEach((m, k) => {
    const a = columnOf.get(m.from);
    const b = m.to === undefined ? undefined : columnOf.get(m.to);
    if (a === undefined || b === undefined) return;
    const width = (sizes[k] as { width: number }).width;
    if (a === b) {
      // A message to itself: its loop and its label sit right of its column.
      if (a + 1 < columns.length) {
        needs[a + 1]?.push({ from: a, gap: SELF_LOOP_WIDTH + width + 2 * LABEL_PAD });
      }
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    needs[hi]?.push({ from: lo, gap: width + 2 * LABEL_PAD });
  });
  const centres: number[] = [];
  columns.forEach((column, i) => {
    let x = column.width / 2;
    if (i > 0) {
      const previous = columns[i - 1] as Column;
      x = (centres[i - 1] as number) + (previous.width + column.width) / 2 + COLUMN_GAP;
    }
    for (const need of needs[i] ?? []) x = Math.max(x, (centres[need.from] as number) + need.gap);
    centres.push(x);
  });

  // Fragments: where each operand is, and how many levels of fragments each one holds.
  const fragmentOfOperand = new Map<string, BoardFragment>();
  for (const f of fragments) for (const op of f.operands) fragmentOfOperand.set(op.id, f);
  const levelsInside = new Map<string, number>();
  const levels = (f: BoardFragment, seen = new Set<string>()): number => {
    const known = levelsInside.get(f.id);
    if (known !== undefined) return known;
    if (seen.has(f.id)) return 0;
    seen.add(f.id);
    const ops = new Set(f.operands.map((o) => o.id));
    const children = fragments.filter((c) => c.parentOperandId && ops.has(c.parentOperandId));
    const value = children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => levels(c, seen)));
    levelsInside.set(f.id, value);
    return value;
  };
  for (const f of fragments) levels(f);

  /** Outermost first: the operands that contain a message. */
  const chainOf = (m: BoardEdge): string[] =>
    m.operandId === undefined ? [] : operandChain(m.operandId, fragments).reverse();

  // Rows: messages in order, with a band for each fragment header and each divider.
  const top = PAD + headHeight + TOP_GAP;
  let y = top;
  const frames = new Map<
    string,
    {
      top: number;
      bottom: number;
      operands: Map<string, number>;
      minX: number;
      maxX: number;
    }
  >();
  const headerOf = new Map<string, { tag: string; label?: string; guard?: string }>();
  const guardText = (operandId: string) => {
    const guard = fragmentOfOperand.get(operandId)?.operands.find((o) => o.id === operandId)?.guard;
    return guard === undefined
      ? undefined
      : wrapText(`[${guard}]`, MAX_TEXT_WIDTH, SMALL_FONT_SIZE);
  };
  const bandHeight = (parts: Array<string | undefined>) =>
    Math.max(
      ...parts.map((p, i) =>
        p === undefined
          ? 0
          : measureText(p, SMALL_FONT_SIZE).height + (i === 0 ? 2 * TAG_PAD_Y : 0),
      ),
    ) +
    2 * BAND_PAD;
  const touch = (fragmentId: string, x0: number, x1: number) => {
    const frame = frames.get(fragmentId);
    if (!frame) return;
    frame.minX = Math.min(frame.minX, x0);
    frame.maxX = Math.max(frame.maxX, x1);
  };

  let open: string[] = [];
  const edges: LaidOutEdge[] = [];
  const close = (operandId: string) => {
    const fragment = fragmentOfOperand.get(operandId) as BoardFragment;
    y += FRAGMENT_BOTTOM;
    const frame = frames.get(fragment.id);
    if (frame) frame.bottom = y;
    y += AFTER_FRAGMENT;
  };
  const openOperand = (operandId: string, divider: boolean) => {
    const fragment = fragmentOfOperand.get(operandId) as BoardFragment;
    const guard = guardText(operandId);
    if (divider) {
      (frames.get(fragment.id) as { operands: Map<string, number> }).operands.set(operandId, y);
      y += bandHeight([undefined, guard]);
      return;
    }
    const header: { tag: string; label?: string; guard?: string } = { tag: fragment.kind };
    if (fragment.label !== undefined) {
      header.label = wrapText(fragment.label, MAX_TEXT_WIDTH, SMALL_FONT_SIZE);
    }
    if (guard !== undefined) header.guard = guard;
    headerOf.set(fragment.id, header);
    frames.set(fragment.id, {
      top: y,
      bottom: y,
      operands: new Map([[operandId, y]]),
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
    });
    y += bandHeight([header.tag, header.label, header.guard]);
  };

  messages.forEach((m, k) => {
    const chain = chainOf(m);
    let p = 0;
    while (p < open.length && p < chain.length && open[p] === chain[p]) p += 1;
    // A switch: the next operand of the fragment being left starts here, after a divider.
    const switching =
      p < open.length &&
      p < chain.length &&
      fragmentOfOperand.get(open[p] as string) === fragmentOfOperand.get(chain[p] as string);
    for (let i = open.length - 1; i >= p; i--) {
      if (i === p && switching) break;
      close(open[i] as string);
    }
    for (let i = p; i < chain.length; i++) openOperand(chain[i] as string, i === p && switching);
    open = chain;

    const size = sizes[k] as { width: number; height: number };
    const text = texts[k] as string;
    const a = columnOf.get(m.from) as number;
    const b = columnOf.get(m.to as string) as number;
    const xa = centres[a] as number;
    const xb = centres[b] as number;
    const lineY = y + size.height + LABEL_GAP;
    let points: Point[];
    let labelX: number;
    let right: number;
    if (a === b) {
      points = [
        [round(xa), round(lineY)],
        [round(xa + SELF_LOOP_WIDTH), round(lineY)],
        [round(xa + SELF_LOOP_WIDTH), round(lineY + SELF_LOOP_HEIGHT)],
        [round(xa), round(lineY + SELF_LOOP_HEIGHT)],
      ];
      labelX = xa + LABEL_PAD;
      right = Math.max(xa + SELF_LOOP_WIDTH, labelX + size.width);
      y = lineY + SELF_LOOP_HEIGHT + ROW_GAP;
    } else {
      points = [
        [round(xa), round(lineY)],
        [round(xb), round(lineY)],
      ];
      labelX = (xa + xb) / 2 - size.width / 2;
      right = Math.max(xa, xb);
      y = lineY + ROW_GAP;
    }
    const left = Math.min(xa, xb);
    for (const operandId of chain) {
      const fragment = fragmentOfOperand.get(operandId);
      if (fragment) touch(fragment.id, left, right);
    }
    edges.push({
      id: m.id,
      from: m.from,
      to: m.to as string,
      kind: "message",
      points,
      label: {
        text,
        fontSize: SMALL_FONT_SIZE,
        x: round(labelX),
        y: round(lineY - LABEL_GAP - size.height),
        width: size.width,
        height: size.height,
      },
      messageType: (m.messageType ?? "sync") as MessageType,
      number: k + 1,
    });
  });
  for (let i = open.length - 1; i >= 0; i--) close(open[i] as string);
  const bottom = y + BOTTOM_GAP - (open.length > 0 ? AFTER_FRAGMENT : 0);

  // Frames: around the columns their messages touch, wider for every level of frames inside,
  // and wide enough for their header.
  const laidFragments: LaidOutSequenceFragment[] = [];
  const depthOf = (f: BoardFragment): number => {
    let depth = 1;
    let parent = f.parentOperandId;
    const seen = new Set([f.id]);
    while (parent !== undefined) {
      const owner = fragmentOfOperand.get(parent);
      if (owner === undefined || seen.has(owner.id)) break;
      seen.add(owner.id);
      depth += 1;
      parent = owner.parentOperandId;
    }
    return depth;
  };
  // Inner frames first: a frame reaches past the right edge of every frame inside it, which a long
  // header or guard may have widened.
  const rightOf = new Map<string, number>();
  const laidById = new Map<string, LaidOutSequenceFragment>();
  const innerFirst = [...fragments].sort((a, b) => depthOf(b) - depthOf(a));
  for (const fragment of innerFirst) {
    const frame = frames.get(fragment.id);
    const header = headerOf.get(fragment.id);
    if (!frame || !header || !Number.isFinite(frame.minX)) continue;
    const inset = (levelsInside.get(fragment.id) ?? 0) * NEST_INSET + FRAGMENT_PAD;
    const x = frame.minX - inset;
    const tagText = measureText(header.tag, SMALL_FONT_SIZE);
    const tag: LaidOutText = {
      text: header.tag,
      fontSize: SMALL_FONT_SIZE,
      x: round(x),
      y: round(frame.top),
      width: tagText.width + 2 * TAG_PAD_X,
      height: tagText.height + 2 * TAG_PAD_Y,
    };
    let cursor = x + tag.width + HEADER_GAP;
    let label: LaidOutText | undefined;
    if (header.label !== undefined) {
      label = textBox(header.label, SMALL_FONT_SIZE, cursor, frame.top + TAG_PAD_Y);
      cursor += label.width + HEADER_GAP;
    }
    const operands = fragment.operands.flatMap((operand, i) => {
      const at = frame.operands.get(operand.id);
      if (at === undefined) return [];
      const guard = guardText(operand.id);
      const out: LaidOutSequenceFragment["operands"][number] = { id: operand.id, y: round(at) };
      if (guard !== undefined) {
        out.guard =
          i === 0
            ? textBox(guard, SMALL_FONT_SIZE, cursor, at + TAG_PAD_Y)
            : textBox(guard, SMALL_FONT_SIZE, x + HEADER_GAP + TAG_PAD_X, at + BAND_PAD);
      }
      return [out];
    });
    const headerRight = Math.max(
      tag.x + tag.width,
      label ? label.x + label.width : 0,
      ...operands.map((o) => (o.guard ? o.guard.x + o.guard.width : 0)),
    );
    const own = new Set(fragment.operands.map((o) => o.id));
    const childRight = Math.max(
      Number.NEGATIVE_INFINITY,
      ...fragments
        .filter((c) => c.parentOperandId !== undefined && own.has(c.parentOperandId))
        .map((c) => (rightOf.get(c.id) ?? Number.NEGATIVE_INFINITY) + NEST_INSET),
    );
    const width = Math.max(frame.maxX + inset, headerRight + HEADER_GAP, childRight) - x;
    rightOf.set(fragment.id, x + width);
    laidById.set(fragment.id, {
      id: fragment.id,
      kind: fragment.kind,
      depth: depthOf(fragment),
      x: round(x),
      y: round(frame.top),
      width: round(width),
      height: round(frame.bottom - frame.top),
      tag,
      ...(label ? { label } : {}),
      operands,
    });
  }
  for (const fragment of fragments) {
    const laid = laidById.get(fragment.id);
    if (laid) laidFragments.push(laid);
  }

  // Shift right so nothing reaches left of the padding: a frame round the first column does.
  const leftmost = Math.min(
    ...columns.map((c, i) => (centres[i] as number) - c.width / 2),
    ...laidFragments.map((f) => f.x),
    Number.POSITIVE_INFINITY,
  );
  const dx = Number.isFinite(leftmost) ? PAD - leftmost : PAD;
  const shift = (v: number) => round(v + dx);
  const shiftText = (t: LaidOutText): LaidOutText => ({ ...t, x: shift(t.x) });

  const nodes: LaidOutNode[] = columns.map((column, i) => {
    const participant = participants[i] as Board["nodes"][number];
    const x = (centres[i] as number) - column.width / 2;
    const contentHeight = column.labelSize.height + CAPTION_GAP + column.captionSize.height;
    const textY = PAD + (headHeight - contentHeight) / 2;
    const out: LaidOutNode = {
      id: column.id,
      kind: "participant",
      shape: "rectangle",
      x: shift(x),
      y: PAD,
      width: round(column.width),
      height: headHeight,
      text: column.label,
      fontSize: FONT_SIZE,
      textWidth: column.labelSize.width,
      textHeight: column.labelSize.height,
      textX: shift((centres[i] as number) - column.labelSize.width / 2),
      textY: round(textY),
      caption: {
        text: column.caption,
        fontSize: SMALL_FONT_SIZE,
        x: shift((centres[i] as number) - column.captionSize.width / 2),
        y: round(textY + column.labelSize.height + CAPTION_GAP),
        width: column.captionSize.width,
        height: column.captionSize.height,
      },
    };
    if (participant.category !== undefined) out.category = participant.category;
    if (participant.ref !== undefined) out.ref = participant.ref;
    return out;
  });
  const placedEdges = edges.map((e) => ({
    ...e,
    points: e.points.map(([px, py]) => [shift(px), py] as Point),
    ...(e.label ? { label: { ...e.label, x: shift(e.label.x) } } : {}),
  }));
  const placedFragments = laidFragments.map((f) => ({
    ...f,
    x: shift(f.x),
    tag: shiftText(f.tag),
    ...(f.label ? { label: shiftText(f.label) } : {}),
    operands: f.operands.map((o) => (o.guard ? { ...o, guard: shiftText(o.guard) } : o)),
  }));
  const lifelines = columns.map((column, i) => ({
    participantId: column.id,
    x: shift(centres[i] as number),
    y1: PAD + headHeight,
    y2: round(bottom),
  }));

  // Questions and notes: a column right of the diagram, in board order.
  let right = Math.max(
    0,
    ...nodes.map((n) => n.x + n.width),
    ...placedFragments.map((f) => f.x + f.width),
    ...placedEdges.map((e) => (e.label ? e.label.x + e.label.width : 0)),
    ...placedEdges.flatMap((e) => e.points.map(([px]) => px)),
  );
  let sideY = PAD;
  const sideX = right + SIDE_GAP;
  for (const node of board.nodes) {
    if (node.kind === "participant") continue;
    const shape = NODE_SHAPES[node.kind];
    const text = nodeText(node);
    const textSize = measureText(text, FONT_SIZE);
    const size = shapeSize(shape, textSize);
    nodes.push({
      id: node.id,
      kind: node.kind,
      shape,
      x: round(sideX),
      y: round(sideY),
      width: size.width,
      height: size.height,
      text,
      fontSize: FONT_SIZE,
      textWidth: textSize.width,
      textHeight: textSize.height,
    });
    sideY += size.height + SIDE_SPACING;
    right = Math.max(right, sideX + size.width);
  }

  return {
    direction: "down",
    width: round(right + PAD),
    height: round(Math.max(bottom, sideY) + PAD),
    nodes,
    groups: [],
    edges: placedEdges,
    sequence: { lifelines, fragments: placedFragments },
  };
}
