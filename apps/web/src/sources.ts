export interface CodeCitation {
  kind?: "code";
  id: string;
  path: string;
  line: number;
  endLine?: number;
  quote?: string;
}

export interface FigmaCitation {
  kind: "figma";
  id: string;
  nodeId: string;
  /** Present only when the scene's URL points at https://www.figma.com. */
  url?: string;
}

/** A requirement document in the repository; checked like code, but a specification. */
export interface DocCitation {
  kind: "doc";
  id: string;
  path: string;
  line: number;
  endLine?: number;
  quote?: string;
  /** Present only when the scene's link is a plain https URL. */
  url?: string;
}

/** A document outside the repository; never checked. */
export interface LinkCitation {
  kind: "link";
  id: string;
  title: string;
  /** The URL's host, shown beside the title; null when the URL is not https. */
  host: string | null;
  quote?: string;
  retrievedAt?: string;
  /** Present only when the URL is a plain https URL. */
  url?: string;
}

/** A client mockup: a committed file (`path`) or a label for one kept elsewhere. */
export interface MockupCitation {
  kind: "mockup";
  id: string;
  label: string;
  path?: string;
  /** Present only when the scene's link is a plain https URL. */
  url?: string;
}

export type Citation = CodeCitation | FigmaCitation | DocCitation | LinkCitation | MockupCitation;

/** How a claim is grounded: by a quoted code source, by a specification only, or not at all. */
export type Grounding = "code" | "spec" | "none";

/** What the side panel shows for one selected node, chip or arrow. */
export interface NodeCitations {
  /** The board node id; for an arrow, its `from` is unknown, so this is the edge id. */
  nodeId: string;
  /** Set for an arrow. */
  edgeId?: string;
  kind: string;
  detail?: string;
  ref?: string;
  toRef?: string;
  role?: string;
  action?: string;
  unresolved?: string;
  layoutFrom?: string;
  /** The text drawn on the node or on the arrow, when it has any. */
  label?: string;
  /** For a navigation: the id of the node it starts from, and that node's text. */
  from?: string;
  fromLabel?: string;
  sources: Citation[];
  /**
   * Set for claims (screens, nodes of grounded kinds, interactive elements, navigates arrows);
   * absent for notes, questions and elements that are only drawn.
   */
  grounding?: Grounding;
  /** Set for a column's row of a table: the column's name. */
  column?: string;
  /** Set for an endpoint: its HTTP method and its path as the route declares it. */
  method?: string;
  path?: string;
  /** Set for a participant of a sequence board: person, system, external, database or queue. */
  category?: string;
  /** Set for a message: its place in message order, how it is sent, and where it goes. */
  number?: number;
  messageType?: string;
  to?: string;
  toLabel?: string;
  /** For a message: the messages before and after it, to step through them in order. */
  previousId?: string;
  nextId?: string;
  /** Set for an operand of a fragment: its id, its fragment's kind and id, and its guard. */
  operandId?: string;
  fragmentId?: string;
  fragmentKind?: string;
  guard?: string;
  /** Added or reworded by a person in the viewer: not checked against any source. */
  manual?: boolean;
  /** What a reworded claim cited before; to check again, never evidence. */
  priorSources?: Citation[];
  /**
   * Set for an endpoint whose handler was read: the checks its route runs before the handler,
   * each with what it cites. Empty when the handler attaches none.
   */
  guards?: Array<{ name: string; sources: Citation[] }>;
  /** Set for an endpoint: the tables and jobs it reads, writes or enqueues, drawn as tags. */
  dataEdges?: DataEdge[];
}

/** A read, write or enqueue drawn as a tag in an endpoint's row. */
export interface DataEdge {
  edgeId: string;
  kind: "reads" | "writes" | "enqueues";
  toRef: string;
  sources: Citation[];
  manual?: boolean;
}

/** The prefix of the scene element of a tag in an endpoint's row. */
export const ROW_TAG_PREFIX = "row-tag/";
const DATA_KINDS = new Set(["reads", "writes", "enqueues"]);

/** The fields of an Excalidraw element this module reads. */
export interface ElementLike {
  id: string;
  isDeleted?: boolean;
  containerId?: string | null;
  customData?: Record<string, unknown> | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A Figma link from a scene is shown only if it is an https URL on www.figma.com. */
export function safeFigmaUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "www.figma.com" &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === ""
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** A link from a scene is shown only if it is a plain https URL: no user name or password. */
export function safeHttpsUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

const optional = (value: Record<string, unknown>, key: string, type: "string" | "number") =>
  typeof value[key] === type ? { [key]: value[key] } : {};

function toCitation(value: unknown): Citation | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  switch (value.kind) {
    case "figma": {
      if (typeof value.nodeId !== "string") return null;
      const url = safeFigmaUrl(value.url);
      return { kind: "figma", id, nodeId: value.nodeId, ...(url ? { url } : {}) };
    }
    case "link": {
      if (typeof value.title !== "string") return null;
      const url = safeHttpsUrl(value.url);
      return {
        kind: "link",
        id,
        title: value.title,
        host: url ? new URL(url).host : null,
        ...optional(value, "quote", "string"),
        ...optional(value, "retrievedAt", "string"),
        ...(url ? { url } : {}),
      };
    }
    case "mockup": {
      if (typeof value.label !== "string") return null;
      const url = safeHttpsUrl(value.url);
      return {
        kind: "mockup",
        id,
        label: value.label,
        ...optional(value, "path", "string"),
        ...(url ? { url } : {}),
      };
    }
    case "doc":
    case "code":
    case undefined: {
      if (typeof value.path !== "string" || typeof value.line !== "number") return null;
      const located = {
        id,
        path: value.path,
        line: value.line,
        ...optional(value, "endLine", "number"),
        ...optional(value, "quote", "string"),
      } as CodeCitation;
      if (value.kind !== "doc") return located;
      const url = safeHttpsUrl(value.url);
      return { ...located, kind: "doc", ...(url ? { url } : {}) };
    }
    default:
      // A kind this viewer does not know yet is left out rather than shown as code.
      return null;
  }
}

const GROUNDINGS = new Set<string>(["code", "spec", "none"]);

/**
 * The grounding of a claim, as the renderer recorded it on every claim it drew. The viewer keeps
 * no rule of its own about which nodes are claims: an element without it is not a claim.
 */
function groundingOf(data: Record<string, unknown>): Grounding | undefined {
  return typeof data.grounding === "string" && GROUNDINGS.has(data.grounding)
    ? (data.grounding as Grounding)
    : undefined;
}

const text = (data: Record<string, unknown>, key: string) =>
  typeof data[key] === "string" ? { [key]: data[key] as string } : {};

/**
 * Reads `customData.groundboard` of a node, chip or arrow element. An arrow counts only when it
 * cites sources or points at another board; null for any other element.
 */
export function nodeCitations(element: ElementLike): NodeCitations | null {
  const data = element.customData?.groundboard;
  if (!isRecord(data)) return null;
  const sources = Array.isArray(data.sources)
    ? data.sources.map(toCitation).filter((c): c is Citation => c !== null)
    : [];
  const grounding = groundingOf(data);
  const prior =
    data.manual === true && Array.isArray(data.priorSources)
      ? data.priorSources.map(toCitation).filter((c): c is Citation => c !== null)
      : [];
  const common = {
    kind: typeof data.kind === "string" ? data.kind : "",
    ...text(data, "detail"),
    ...text(data, "ref"),
    ...text(data, "toRef"),
    ...text(data, "role"),
    ...text(data, "action"),
    ...text(data, "unresolved"),
    ...text(data, "layoutFrom"),
    ...text(data, "from"),
    ...text(data, "column"),
    ...text(data, "method"),
    ...text(data, "path"),
    ...text(data, "category"),
    ...text(data, "messageType"),
    ...text(data, "to"),
    ...text(data, "fragmentId"),
    ...text(data, "fragmentKind"),
    ...text(data, "guard"),
    ...(typeof data.number === "number" ? { number: data.number } : {}),
    sources,
    ...(grounding ? { grounding } : {}),
    ...(data.manual === true ? { manual: true } : {}),
    ...(prior.length > 0 ? { priorSources: prior } : {}),
    ...(Array.isArray(data.guards) ? { guards: data.guards.flatMap(toGuard) } : {}),
  };
  if (typeof data.nodeId === "string") return { nodeId: data.nodeId, ...common };
  // An operand of a fragment: its frame, its tag, its guard or its divider.
  if (typeof data.operandId === "string") {
    return { nodeId: data.operandId, operandId: data.operandId, ...common };
  }
  if (
    typeof data.edgeId === "string" &&
    (sources.length > 0 || typeof data.toRef === "string" || data.manual === true)
  ) {
    return { nodeId: data.edgeId, edgeId: data.edgeId, ...common };
  }
  return null;
}

function toGuard(value: unknown): Array<{ name: string; sources: Citation[] }> {
  if (!isRecord(value) || typeof value.name !== "string") return [];
  const sources = Array.isArray(value.sources)
    ? value.sources.map(toCitation).filter((c): c is Citation => c !== null)
    : [];
  return [{ name: value.name, sources }];
}

/** The tags drawn in the row of an endpoint, in scene order. */
export function endpointDataEdges(elements: readonly ElementLike[], nodeId: string): DataEdge[] {
  const out: DataEdge[] = [];
  for (const element of elements) {
    if (element.isDeleted || !element.id.startsWith(ROW_TAG_PREFIX)) continue;
    if (element.id.slice(ROW_TAG_PREFIX.length).includes("/")) continue; // the tag's text
    const data = element.customData?.groundboard;
    if (!isRecord(data) || data.from !== nodeId) continue;
    if (typeof data.edgeId !== "string" || typeof data.toRef !== "string") continue;
    if (typeof data.kind !== "string" || !DATA_KINDS.has(data.kind)) continue;
    out.push({
      edgeId: data.edgeId,
      kind: data.kind as DataEdge["kind"],
      toRef: data.toRef,
      sources: Array.isArray(data.sources)
        ? data.sources.map(toCitation).filter((c): c is Citation => c !== null)
        : [],
      ...(data.manual === true ? { manual: true } : {}),
    });
  }
  return out;
}

const textOf = (element: ElementLike): string =>
  "text" in element && typeof element.text === "string" ? element.text : "";

/** Longest label the side panel shows; a longer one is cut with an ellipsis. */
const MAX_LABEL = 120;

function tidy(label: string): string | undefined {
  const flat = label.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/** The text of each container, by container id: the label bound to a shape or an arrow. */
function boundLabels(elements: readonly ElementLike[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const element of elements) {
    if (element.containerId && !element.isDeleted) labels.set(element.containerId, textOf(element));
  }
  return labels;
}

/** The text drawn for a node: its bound label, or its own text for a text element. */
function nodeLabel(
  elements: readonly ElementLike[],
  labels: ReadonlyMap<string, string>,
  nodeId: string,
): string | undefined {
  const element = elementForNode(elements, nodeId);
  if (!element) return undefined;
  // A card's row draws its text beside the box, as `<id>/text`, not bound to it.
  const rowText = elements.find((e) => e.id === `${element.id}/text` && !e.isDeleted);
  return tidy(labels.get(element.id) ?? (rowText ? textOf(rowText) : textOf(element)));
}

/** The text drawn beside an arrow that is not bound to it: a message's numbered label. */
function edgeLabelText(elements: readonly ElementLike[], edgeId: string): string {
  const label = elements.find((e) => e.id === `edge-label/${edgeId}` && !e.isDeleted);
  return label ? textOf(label) : "";
}

/** The messages of a sequence board, in message order: edge id and number. */
export function sequenceMessages(
  elements: readonly ElementLike[],
): Array<{ edgeId: string; number: number }> {
  const out: Array<{ edgeId: string; number: number }> = [];
  for (const element of elements) {
    if (element.isDeleted || !element.id.startsWith("edge/")) continue;
    const data = element.customData?.groundboard;
    if (!isRecord(data) || data.kind !== "message" || typeof data.edgeId !== "string") continue;
    if (element.id !== `edge/${data.edgeId}` || typeof data.number !== "number") continue;
    out.push({ edgeId: data.edgeId, number: data.number });
  }
  return out.sort((a, b) => a.number - b.number);
}

function messageNeighbours(
  elements: readonly ElementLike[],
  edgeId: string | undefined,
): { previousId?: string; nextId?: string } {
  const messages = sequenceMessages(elements);
  const at = messages.findIndex((m) => m.edgeId === edgeId);
  if (at < 0) return {};
  const previous = messages[at - 1];
  const next = messages[at + 1];
  return {
    ...(previous ? { previousId: previous.edgeId } : {}),
    ...(next ? { nextId: next.edgeId } : {}),
  };
}

/** Adds the text drawn for the node or arrow, and for the node a navigation starts from. */
function withLabels(
  citations: NodeCitations,
  elements: readonly ElementLike[],
  labels: ReadonlyMap<string, string>,
): NodeCitations {
  const label =
    citations.edgeId !== undefined
      ? tidy(labels.get(`edge-${citations.edgeId}`) ?? edgeLabelText(elements, citations.edgeId))
      : citations.operandId !== undefined
        ? undefined
        : nodeLabel(elements, labels, citations.nodeId);
  const fromLabel =
    citations.from !== undefined ? nodeLabel(elements, labels, citations.from) : undefined;
  const toLabel =
    citations.to !== undefined && citations.kind === "message"
      ? nodeLabel(elements, labels, citations.to)
      : undefined;
  return {
    ...citations,
    ...(label !== undefined ? { label } : {}),
    ...(fromLabel !== undefined ? { fromLabel } : {}),
    ...(toLabel !== undefined ? { toLabel } : {}),
    ...(citations.kind === "message" ? messageNeighbours(elements, citations.edgeId) : {}),
  };
}

/**
 * Collects the citations of the selected elements. A selected bound label counts as its
 * container, and the marks drawn on a wireframe element count as the element, so each node
 * or arrow appears once.
 */
export function selectedCitations(
  elements: readonly ElementLike[],
  selectedIds: Readonly<Record<string, boolean>>,
): NodeCitations[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const labels = boundLabels(elements);
  const seen = new Set<string>();
  const result: NodeCitations[] = [];
  for (const [id, selected] of Object.entries(selectedIds)) {
    if (!selected) continue;
    let element = byId.get(id);
    if (element?.containerId) element = byId.get(element.containerId) ?? element;
    if (!element || element.isDeleted) continue;
    const citations = nodeCitations(element);
    if (!citations) continue;
    const key =
      citations.edgeId !== undefined
        ? `edge:${citations.edgeId}`
        : citations.operandId !== undefined
          ? `operand:${citations.operandId}`
          : `node:${citations.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const labelled = withLabels(citations, elements, labels);
    if (citations.kind === "endpoint" && citations.edgeId === undefined) {
      const dataEdges = endpointDataEdges(elements, citations.nodeId);
      if (dataEdges.length > 0) labelled.dataEdges = dataEdges;
    }
    result.push(labelled);
  }
  return result;
}

/**
 * `path:line` or `path:line-endLine` for code and documents; `Figma <node>`, `Link <title>`
 * and `Mockup <path or label>` for the other specification sources.
 */
export function formatLocation(citation: Citation): string {
  switch (citation.kind) {
    case "figma":
      return `Figma ${citation.nodeId}`;
    case "link":
      return `Link ${citation.title}`;
    case "mockup":
      return `Mockup ${citation.path ?? citation.label}`;
    case undefined:
    case "code":
    case "doc":
      return citation.endLine !== undefined && citation.endLine !== citation.line
        ? `${citation.path}:${citation.line}-${citation.endLine}`
        : `${citation.path}:${citation.line}`;
    default: {
      const unknown: never = citation;
      return String(unknown);
    }
  }
}

/** Whether the citation is code (as opposed to a specification). */
export function isCodeCitation(citation: Citation): citation is CodeCitation {
  return citation.kind === undefined || citation.kind === "code";
}

/** Whether `atlas check` can check the source: code, documents and committed mockups. */
export function isCheckedCitation(citation: Citation): boolean {
  switch (citation.kind) {
    case undefined:
    case "code":
    case "doc":
      return true;
    case "mockup":
      return citation.path !== undefined;
    case "figma":
    case "link":
      return false;
    default: {
      const unknown: never = citation;
      return Boolean(unknown);
    }
  }
}

/** Finds the main element drawn for a board node: the one carrying its data, not a mark. */
export function elementForNode(
  elements: readonly ElementLike[],
  nodeId: string,
): ElementLike | null {
  // `node-<id>` in scenes rendered before element ids were `/`-separated.
  for (const id of [`node/${nodeId}`, `node-${nodeId}`]) {
    const main = elements.find((e) => e.id === id && !e.isDeleted);
    if (main) return main;
  }
  const carrier = elements.find((e) => {
    const data = e.customData?.groundboard;
    return !e.isDeleted && isRecord(data) && data.nodeId === nodeId;
  });
  if (carrier) return carrier;
  // A message of a sequence board is reached the same way, by its edge id.
  return elements.find((e) => e.id === `edge/${nodeId}` && !e.isDeleted) ?? null;
}

/** Whether the board check found that this source no longer matches its file. */
export function isStale(source: Citation, staleIds: ReadonlySet<string>): boolean {
  return source.id !== "" && staleIds.has(source.id);
}

/** A node of the board on screen, as the command palette lists it. */
export interface BoardNode {
  nodeId: string;
  kind: string;
  /** The text drawn on the node, when it has any. */
  label: string;
  /** Where its first source is, `path:line` or `Figma <node>`; null when it cites none. */
  location: string | null;
}

/** Every node of the board, once each, in scene order; arrows are left out. */
export function boardNodes(elements: readonly ElementLike[]): BoardNode[] {
  const labels = boundLabels(elements);
  const seen = new Set<string>();
  const nodes: BoardNode[] = [];
  for (const element of elements) {
    if (element.isDeleted) continue;
    const data = element.customData?.groundboard;
    if (!isRecord(data) || typeof data.nodeId !== "string" || seen.has(data.nodeId)) continue;
    const citations = nodeCitations(element);
    if (!citations) continue;
    seen.add(data.nodeId);
    const first = citations.sources[0];
    const own = elements.find((e) => e.id === `${element.id}/text` && !e.isDeleted);
    nodes.push({
      nodeId: data.nodeId,
      kind: citations.role ?? citations.kind,
      label: (labels.get(element.id) ?? (own ? textOf(own) : textOf(element)))
        .replace(/\s+/g, " ")
        .trim(),
      location: first ? formatLocation(first) : null,
    });
  }
  // The messages of a sequence board, by their number and label, so the palette reaches them.
  for (const message of sequenceMessages(elements)) {
    if (seen.has(message.edgeId)) continue;
    const element = elements.find((e) => e.id === `edge/${message.edgeId}`) as ElementLike;
    const citations = nodeCitations(element);
    const first = citations?.sources[0];
    nodes.push({
      nodeId: message.edgeId,
      kind: "message",
      label: edgeLabelText(elements, message.edgeId).replace(/\s+/g, " ").trim(),
      location: first ? formatLocation(first) : null,
    });
  }
  return nodes;
}

/**
 * The screen ref a selection points at, when the selection is the tag, the number or the list
 * line of one `toRef` edge (selecting either selects the whole group); null for anything else.
 */
export function selectedRefTarget(
  elements: readonly ElementLike[],
  selectedIds: Readonly<Record<string, boolean>>,
): string | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let edgeId: string | null = null;
  let target: string | null = null;
  for (const [id, selected] of Object.entries(selectedIds)) {
    if (!selected) continue;
    const data = byId.get(id)?.customData?.groundboard;
    if (!isRecord(data)) return null;
    // A message or a participant of a sequence board names what it reaches with `ref`.
    const sequenceRef =
      (data.kind === "message" || data.kind === "participant") && typeof data.ref === "string"
        ? data.ref
        : undefined;
    const key =
      typeof data.edgeId === "string"
        ? data.edgeId
        : data.kind === "participant" && typeof data.nodeId === "string"
          ? `node:${data.nodeId}`
          : null;
    const ref = typeof data.toRef === "string" ? data.toRef : sequenceRef;
    if (key === null || ref === undefined) return null;
    if (edgeId !== null && key !== edgeId) return null;
    edgeId = key;
    target = ref;
  }
  return target;
}
