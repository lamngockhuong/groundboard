import type {
  LaidOutEdge,
  LaidOutNode,
  LaidOutSequence,
  LaidOutSequenceFragment,
} from "@groundboard/layout/types";
import { arrow, type ExcalidrawElement, line, shape, type TextElement, text } from "./elements.ts";
import {
  FRAGMENT_COLOR,
  FRAGMENT_TAG_FILL,
  INK,
  LIFELINE_COLOR,
  MESSAGE_STYLES,
  PARTICIPANT_STYLES,
  PERSON_COLOR,
  SPEC_STROKE,
} from "./styles.ts";

/**
 * The parts of a sequence board: participants, lifelines, messages and fragments. Element ids
 * follow the renderer's scheme: `node/<id>` for a participant and `edge/<id>` for a message,
 * with a `/<part>` suffix for what is drawn with them; `lifeline/`, `fragment/`, `fragment-tag/`,
 * `operand-guard/` and `operand-line/` for the rest. Everything a reader may select carries
 * `customData.groundboard`; a lifeline carries none and is locked, so a click on it reaches
 * nothing and a message beside it stays easy to pick.
 */

export const lifelineElementId = (id: string) => `lifeline/${id}`;
export const fragmentElementId = (id: string) => `fragment/${id}`;
export const fragmentTagElementId = (id: string) => `fragment-tag/${id}`;
export const operandGuardElementId = (id: string) => `operand-guard/${id}`;
export const operandLineElementId = (id: string) => `operand-line/${id}`;

const round = (n: number) => Math.round(n * 100) / 100;

/** Room around a label's backdrop, which keeps lifelines and dividers from running through it. */
const BACKDROP_PAD = 2;

/**
 * A borderless canvas-coloured box behind a piece of text, carrying the same data. Drawn right
 * after the lifelines, so it hides a lifeline that runs through the text and nothing else.
 */
function backdrop(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  customData: Record<string, unknown>,
): ExcalidrawElement {
  return shape("rectangle", {
    id,
    x: round(box.x - BACKDROP_PAD),
    y: round(box.y - BACKDROP_PAD),
    width: round(box.width + 2 * BACKDROP_PAD),
    height: round(box.height + 2 * BACKDROP_PAD),
    strokeColor: "transparent",
    backgroundColor: "#ffffff",
    customData,
  });
}

type Mark = { dotted: boolean; tag?: string };
type Tag = (
  id: string,
  x: number,
  y: number,
  customData: Record<string, unknown>,
  label?: string,
) => TextElement;

/**
 * A participant: its box, its label and its category under it, and the mark of its category:
 * a figure for a person (who has no box), arcs of a cylinder for a database, bars for a queue.
 * Every part carries the participant's data and shares one group, so a click selects it whole.
 */
export function renderParticipant(
  node: LaidOutNode,
  customData: Record<string, unknown>,
  mark: Mark,
  tag: Tag,
): ExcalidrawElement[] {
  const category = node.category ?? "system";
  const style = PARTICIPANT_STYLES[category];
  const id = `node/${node.id}`;
  const common = { customData, groupIds: [`participant-${node.id}`] };
  const out: ExcalidrawElement[] = [
    shape("rectangle", {
      id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      strokeColor: style.strokeColor,
      backgroundColor: style.backgroundColor,
      strokeStyle: mark.dotted && category !== "person" ? SPEC_STROKE : style.strokeStyle,
      roundness: { type: 3 },
      ...common,
    }),
    text({
      id: `${id}/text`,
      x: node.textX ?? node.x,
      y: node.textY ?? node.y,
      width: node.textWidth,
      height: node.textHeight,
      text: node.text,
      fontSize: node.fontSize,
      strokeColor: style.textColor,
      ...common,
    }),
  ];
  if (node.caption) {
    out.push(
      text({
        id: `${id}/caption`,
        x: node.caption.x,
        y: node.caption.y,
        width: node.caption.width,
        height: node.caption.height,
        text: node.caption.text,
        fontSize: node.caption.fontSize,
        strokeColor: INK,
        ...common,
      }),
    );
  }
  const { x, y, width, height } = node;
  if (category === "person") {
    // A head and a body at the top-left, inside the box's padding.
    out.push(
      shape("ellipse", {
        id: `${id}/head`,
        x: round(x + 6),
        y: round(y + 6),
        width: 9,
        height: 9,
        strokeColor: PERSON_COLOR,
        ...common,
      }),
      line({
        id: `${id}/body`,
        x: round(x + 10.5),
        y: round(y + 15),
        width: 6,
        height: 12,
        points: [
          [0, 0],
          [0, 7],
          [-4, 12],
          [0, 7],
          [4, 12],
        ],
        strokeColor: PERSON_COLOR,
        ...common,
      }),
    );
  } else if (category === "database") {
    // The rim of a cylinder at the top and its base at the bottom.
    for (const [part, top] of [
      ["rim", y + 2],
      ["base", y + height - 12],
    ] as const) {
      out.push(
        shape("ellipse", {
          id: `${id}/${part}`,
          x: round(x + 4),
          y: round(top),
          width: round(width - 8),
          height: 10,
          strokeColor: style.strokeColor,
          ...common,
        }),
      );
    }
  } else if (category === "queue") {
    // Three bars down the right edge: messages waiting in line.
    [14, 10, 6].forEach((inset, i) => {
      out.push(
        line({
          id: `${id}/bar${i + 1}`,
          x: round(x + width - inset),
          y: round(y + 8),
          width: 0,
          height: round(height - 16),
          points: [
            [0, 0],
            [0, round(height - 16)],
          ],
          strokeColor: style.strokeColor,
          ...common,
        }),
      );
    });
  }
  if (mark.tag) out.push(tag(`${id}/manual`, x, y + height + 2, customData, mark.tag));
  return out;
}

/** The lifelines: a dashed neutral line down from each participant, locked, carrying no data. */
export function renderLifelines(sequence: LaidOutSequence): ExcalidrawElement[] {
  return sequence.lifelines.map((lifeline) =>
    line({
      id: lifelineElementId(lifeline.participantId),
      x: lifeline.x,
      y: lifeline.y1,
      width: 0,
      height: round(lifeline.y2 - lifeline.y1),
      points: [
        [0, 0],
        [0, round(lifeline.y2 - lifeline.y1)],
      ],
      strokeColor: LIFELINE_COLOR,
      strokeStyle: "dashed",
      locked: true,
    }),
  );
}

/** A message: its arrow, unbound so it stays on its row, and its numbered label above it. */
export function renderMessage(
  edge: LaidOutEdge,
  customData: Record<string, unknown>,
  mark: Mark,
  tag: Tag,
): ExcalidrawElement[] {
  const style = MESSAGE_STYLES[edge.messageType ?? "sync"];
  const [x0, y0] = edge.points[0] ?? [0, 0];
  const xs = edge.points.map((p) => p[0]);
  const ys = edge.points.map((p) => p[1]);
  const id = `edge/${edge.id}`;
  const out: ExcalidrawElement[] = [
    arrow({
      id,
      x: x0,
      y: y0,
      width: round(Math.max(...xs) - Math.min(...xs)),
      height: round(Math.max(...ys) - Math.min(...ys)),
      points: edge.points.map(([px, py]) => [round(px - x0), round(py - y0)]),
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: style.endArrowhead,
      strokeColor: style.strokeColor,
      strokeStyle: mark.dotted ? SPEC_STROKE : style.strokeStyle,
      customData,
    }),
  ];
  if (edge.label) {
    out.push(
      text({
        id: `edge-label/${edge.id}`,
        x: edge.label.x,
        y: edge.label.y,
        width: edge.label.width,
        height: edge.label.height,
        text: edge.label.text,
        fontSize: edge.label.fontSize,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: INK,
        customData,
      }),
    );
  }
  if (mark.dotted) {
    const right = edge.label ? edge.label.x + edge.label.width + 4 : Math.max(...xs) + 4;
    out.push(tag(`${id}/spec`, right, edge.label?.y ?? y0, customData, mark.tag));
  }
  return out;
}

/**
 * A fragment: its frame, its kind in a tag at the top-left corner, its label, each operand's
 * guard, and a dashed divider above every operand but the first. The frame and the tag select
 * the fragment by its first operand; a guard and a divider select their own operand.
 */
export function renderFragment(
  fragment: LaidOutSequenceFragment,
  dataOf: (operandId: string) => Record<string, unknown>,
): ExcalidrawElement[] {
  const first = fragment.operands[0]?.id ?? fragment.id;
  const own = dataOf(first);
  const out: ExcalidrawElement[] = [
    shape("rectangle", {
      id: fragmentElementId(fragment.id),
      x: fragment.x,
      y: fragment.y,
      width: fragment.width,
      height: fragment.height,
      strokeColor: FRAGMENT_COLOR,
      customData: own,
    }),
    shape("rectangle", {
      id: fragmentTagElementId(fragment.id),
      x: fragment.tag.x,
      y: fragment.tag.y,
      width: fragment.tag.width,
      height: fragment.tag.height,
      strokeColor: FRAGMENT_COLOR,
      backgroundColor: FRAGMENT_TAG_FILL,
      customData: own,
    }),
    text({
      id: `${fragmentTagElementId(fragment.id)}/text`,
      x: round(fragment.tag.x + 6),
      y: round(fragment.tag.y + 2),
      width: round(fragment.tag.width - 12),
      height: round(fragment.tag.height - 4),
      text: fragment.tag.text,
      fontSize: fragment.tag.fontSize,
      strokeColor: INK,
      customData: own,
    }),
  ];
  if (fragment.label) {
    out.push(
      text({
        id: `fragment-label/${fragment.id}`,
        x: fragment.label.x,
        y: fragment.label.y,
        width: fragment.label.width,
        height: fragment.label.height,
        text: fragment.label.text,
        fontSize: fragment.label.fontSize,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: INK,
        customData: own,
      }),
    );
  }
  fragment.operands.forEach((operand, i) => {
    const data = dataOf(operand.id);
    if (i > 0) {
      out.push(
        line({
          id: operandLineElementId(operand.id),
          x: fragment.x,
          y: operand.y,
          width: fragment.width,
          height: 0,
          points: [
            [0, 0],
            [fragment.width, 0],
          ],
          strokeColor: FRAGMENT_COLOR,
          strokeStyle: "dashed",
          customData: data,
        }),
      );
    }
    if (operand.guard) {
      out.push(
        text({
          id: operandGuardElementId(operand.id),
          x: operand.guard.x,
          y: operand.guard.y,
          width: operand.guard.width,
          height: operand.guard.height,
          text: operand.guard.text,
          fontSize: operand.guard.fontSize,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: INK,
          customData: data,
        }),
      );
    }
  });
  return out;
}

/** The backdrops of a message's label and of every guard, to draw right after the lifelines. */
export function sequenceBackdrops(
  edges: readonly LaidOutEdge[],
  fragments: readonly LaidOutSequenceFragment[],
  edgeData: (edgeId: string) => Record<string, unknown>,
  operandData: (operandId: string) => Record<string, unknown>,
): ExcalidrawElement[] {
  const out: ExcalidrawElement[] = [];
  for (const edge of edges) {
    if (edge.label)
      out.push(backdrop(`edge-label/${edge.id}/backdrop`, edge.label, edgeData(edge.id)));
  }
  for (const fragment of fragments) {
    for (const operand of fragment.operands) {
      if (operand.guard) {
        out.push(
          backdrop(
            `${operandGuardElementId(operand.id)}/backdrop`,
            operand.guard,
            operandData(operand.id),
          ),
        );
      }
    }
  }
  return out;
}
