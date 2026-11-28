import * as z from "zod";
import { LIMITS, SCHEMA_VERSION } from "./limits.ts";
import { PLATFORMS, parseRef, REF_NAMESPACE_SYNTAX } from "./ref.ts";
import { MAX_NODE_WIDTH } from "./wireframe-size.ts";

export const NODE_KINDS = [
  "step",
  "state",
  "decision",
  "cause",
  "rejected",
  "fact",
  "question",
  "note",
  "screen",
  "element",
  "resource",
  "endpoint",
  "table",
  "job",
] as const;

/** Node kinds that state a claim about the code, so they must cite at least one quoted source. */
export const GROUNDED_KINDS = [
  "step",
  "state",
  "cause",
  "decision",
  "rejected",
  "fact",
  "screen",
  "endpoint",
  "table",
  "job",
] as const;

export const EDGE_KINDS = [
  "flow",
  "transition",
  "causes",
  "blocks",
  "relates",
  "navigates",
  "calls",
  "references",
  "reads",
  "writes",
  "enqueues",
] as const;

/** What starts a background job. */
export const TRIGGER_TYPES = ["cron", "queue", "event", "manual"] as const;

/** How many rows of one table a foreign key relates to how many of the other. */
export const CARDINALITIES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"] as const;

/** HTTP methods an API endpoint may have. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** What an element of a screen wireframe is drawn as. */
export const ELEMENT_ROLES = [
  "container",
  "text",
  "button",
  "link",
  "input",
  "checkbox",
  "image",
  "icon",
  "bar",
] as const;

/** Roles a person acts on; such an element needs a cited handler or `unresolved`. */
export const INTERACTIVE_ROLES = ["button", "link", "input", "checkbox"] as const;

/**
 * Where a screen's wireframe layout came from: a Figma frame, a screenshot of the running app,
 * a client mockup, a document that describes the screen without a layout (no elements), or code.
 */
export const LAYOUT_ORIGINS = ["figma", "screenshot", "mockup", "doc", "code"] as const;
export const DIRECTIONS = ["row", "column"] as const;

export type ElementRole = (typeof ELEMENT_ROLES)[number];
export type LayoutOrigin = (typeof LAYOUT_ORIGINS)[number];

export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];

const id = z
  .string()
  .min(1)
  .max(LIMITS.id)
  .regex(/^[A-Za-z0-9_.:-]+$/, "ids may contain only letters, digits, '_', '.', ':' and '-'");

const longText = z.string().max(LIMITS.longText);
const shortText = z.string().max(LIMITS.shortText);

/** Repository-relative path: no leading slash, no drive letter, no `..` segment. */
export const repoPath = shortText.min(1).superRefine((value, ctx) => {
  if (/^[/\\]/.test(value) || /^[A-Za-z]:/.test(value)) {
    ctx.addIssue({
      code: "custom",
      message: "path must be relative to the repository root, not absolute",
    });
    return;
  }
  if (value.split(/[/\\]/).includes("..")) {
    ctx.addIssue({ code: "custom", message: "path must not contain a '..' segment" });
    return;
  }
  if (value.includes("\0")) {
    ctx.addIssue({ code: "custom", message: "path must not contain a NUL character" });
  }
});

/** Query parameter names that carry a credential or a signature; a committed board must not hold one. */
const SECRET_PARAMS = new Set([
  "token",
  "access_token",
  "sig",
  "signature",
  "key",
  "apikey",
  "api_key",
  "password",
]);
const SECRET_PARAM_PREFIXES = ["x-amz-", "x-goog-"];

/**
 * An absolute https: URL without credentials. `field` names the field in messages. With
 * `bare`, the URL must have no query or fragment; otherwise query parameters that look like
 * a credential are refused. Messages never repeat a parameter's value.
 */
function httpsUrlOf(field: string, options: { bare: boolean }) {
  return z.string().superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: `${field} must be an absolute https: URL` });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: `${field} must use https:` });
      return;
    }
    if (url.username !== "" || url.password !== "") {
      ctx.addIssue({
        code: "custom",
        message: `${field} must not contain a user name, password or token`,
      });
    }
    if (options.bare) {
      if (url.search !== "" || url.hash !== "") {
        ctx.addIssue({
          code: "custom",
          message: `${field} must be the repository URL alone, without a query or fragment`,
        });
      }
      return;
    }
    for (const name of new Set(url.searchParams.keys())) {
      const lower = name.toLowerCase();
      if (SECRET_PARAMS.has(lower) || SECRET_PARAM_PREFIXES.some((p) => lower.startsWith(p))) {
        ctx.addIssue({
          code: "custom",
          message: `${field} has a query parameter \`${name.slice(0, 40)}\` that looks like a credential or signature; boards are committed, so link to the document without it`,
        });
        return;
      }
    }
  });
}

const httpsUrl = httpsUrlOf("repo.url", { bare: true });
const specUrl = httpsUrlOf("url", { bare: false });

const atlasRef = z.string().superRefine((value, ctx) => {
  if (parseRef(value) === null) {
    ctx.addIssue({
      code: "custom",
      message: `ref must be \`${REF_NAMESPACE_SYNTAX}:<slug>\` or \`${REF_NAMESPACE_SYNTAX}:<slug>/<slug>\` (a screen and its element, a resource and its endpoint, a table and its column, a job), slugs in lowercase letters, digits and single hyphens, at most 60 characters`,
    });
  }
});

export const CodeSourceSchema = z.object({
  id,
  /** Omitted `kind` means a code source, so boards written before Figma sources stay valid. */
  kind: z.literal("code").default("code"),
  path: repoPath,
  line: z.int().min(1),
  endLine: z.int().min(1).optional(),
  quote: longText.optional(),
});

/**
 * A Figma node id: `12:34`, or a layer inside an instance, `I12:34;56:78` (the instance, then
 * the path of definition ids down to the layer, separated by `;`).
 */
export const FIGMA_NODE_ID = /^(?:\d+:\d+|I\d+:\d+(?:;\d+:\d+)+)$/;

/**
 * A Figma node. The board stores no URL: renderers build it from `fileKey` and `nodeId`,
 * so a board cannot carry a link that only looks like Figma.
 */
export const FigmaSourceSchema = z.object({
  id,
  kind: z.literal("figma"),
  fileKey: z
    .string()
    .regex(/^[A-Za-z0-9]{10,64}$/, "fileKey must be 10 to 64 letters or digits from the Figma URL"),
  nodeId: z
    .string()
    .regex(
      FIGMA_NODE_ID,
      "nodeId must look like `12:34`, or `I12:34;56:78` for a layer inside an instance; write the URL's `node-id=12-34` as `12:34`",
    ),
});

/**
 * A requirement document in the repository (Markdown, text). Checked like code: the file
 * exists, the lines exist and the quote appears in them, so editing the requirement makes the
 * board stale. Spec tier: it says what should happen, not what the code does.
 */
export const DocSourceSchema = z.object({
  id,
  kind: z.literal("doc"),
  path: repoPath,
  line: z.int().min(1),
  endLine: z.int().min(1).optional(),
  quote: longText.min(1),
});

/**
 * A document outside the repository (a Google Doc, a wiki page). Never fetched or checked.
 * Copying the document into the repository and citing it as `doc` is preferred.
 */
export const LinkSourceSchema = z.object({
  id,
  kind: z.literal("link"),
  url: specUrl,
  title: shortText.min(1),
  /** The cited passage; required for the link to back an action or a navigation. */
  quote: longText.optional(),
  /** When the passage was copied, as an ISO date (`2026-11-19`). */
  retrievedAt: z.iso.date().optional(),
});

/**
 * A client mockup. With `path`, a file in the repository whose existence is checked (its
 * content is never read); without, a mockup kept elsewhere, named by `label` only.
 */
export const MockupSourceSchema = z.object({
  id,
  kind: z.literal("mockup"),
  label: shortText.min(1),
  path: repoPath.optional(),
});

export const SourceSchema = z.discriminatedUnion("kind", [
  CodeSourceSchema,
  FigmaSourceSchema,
  DocSourceSchema,
  LinkSourceSchema,
  MockupSourceSchema,
]);

export const GroupSchema = z.object({
  id,
  label: shortText.min(1),
  parentId: id.optional(),
});

/** One column of a database table, as its migration or model declares it. */
export const ColumnSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_$ .-]*$/, "a column name is an identifier"),
  type: z.string().min(1).max(60).optional(),
  pk: z.boolean().optional(),
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.string().max(200).optional(),
  note: shortText.optional(),
  /** Where this column is declared; without it the table's own sources stand for it. */
  sourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).optional(),
});

/**
 * What starts a job: a schedule (`cron`, with `schedule`), a message on a queue (`queue`), an
 * event (`event`), or a person or a deploy (`manual`).
 */
export const TriggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  schedule: z.string().min(1).max(100).optional(),
  queue: z.string().min(1).max(120).optional(),
  event: z.string().min(1).max(120).optional(),
});

/** How often a failed run is tried again, and how long it waits between tries. */
export const RetrySchema = z.object({
  attempts: z.int().min(0).max(1000),
  backoff: z.string().min(1).max(60).optional(),
});

/**
 * A check an endpoint's route runs before its handler: a middleware, a decorator such as
 * `@UseGuards`, a role or policy check. `name` is how the code names it; `sourceIds` cite the
 * line that attaches it to the route.
 */
export const GuardSchema = z.object({
  name: z.string().min(1).max(120),
  sourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).default([]),
});

export const NodeSchema = z.object({
  id,
  kind: z.enum(NODE_KINDS),
  label: longText.min(1),
  detail: longText.optional(),
  groupId: id.optional(),
  sourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).default([]),
  /**
   * Defines the atlas ref on a `screen`, `element`, `resource` or `endpoint`; on any other
   * kind it refers to one.
   */
  ref: atlasRef.optional(),
  /** `element`: the screen or element that contains it. `endpoint`: its resource. */
  parentId: id.optional(),
  /** `element` only. */
  role: z.enum(ELEMENT_ROLES).optional(),
  /** `screen` and `element` with children: how children are stacked. Defaults to column. */
  direction: z.enum(DIRECTIONS).optional(),
  /** `element` only: what acting on it does. */
  action: longText.min(1).optional(),
  /** `element` only: who must answer when no handler was found. */
  unresolved: longText.min(1).optional(),
  /** `screen` only, required: where the wireframe layout came from. */
  layoutFrom: z.enum(LAYOUT_ORIGINS).optional(),
  /** `screen` only, required: must match the ref prefix. */
  platform: z.enum(PLATFORMS).optional(),
  /**
   * `screen` only: the id of the screen on this board whose state this screen draws (a wizard
   * step, a loading or error branch, a dialog opened by state). A state has no ref; its
   * platform and layoutFrom are the root's, and its elements' refs extend the root's ref.
   */
  stateOf: id.optional(),
  /**
   * `screen` only: this screen is a shared layout (a header, a footer, a sidebar) drawn once
   * rather than a route. Its elements define refs such as `web:layout/header-logout` that the
   * screens listing it in `layouts` carry on their own copies of those elements.
   */
  layout: z.literal(true).optional(),
  /**
   * `screen` only: the refs of the layout screens this screen is drawn in, e.g.
   * `["web:layout"]`. An element of this screen may then carry a ref of one of those layouts,
   * which points at the layout's element instead of defining a ref of its own.
   */
  layouts: z.array(atlasRef).min(1).max(LIMITS.layoutsPerScreen).optional(),
  /**
   * `screen` with elements: the frame's content width in pixels, within the platform's bounds;
   * defaults to the platform's width. `element` in a row: the element's fixed width in pixels;
   * the row shares what is left among its children without a width.
   */
  width: z.number().int().positive().max(MAX_NODE_WIDTH).optional(),
  /** `endpoint` only, required: its HTTP method. */
  method: z.enum(HTTP_METHODS).optional(),
  /** `endpoint` only, required: its path as the route declares it, starting with `/`. */
  path: z.string().min(1).max(LIMITS.shortText).optional(),
  /**
   * `endpoint` only: the checks its route runs before the handler. Omitted: the handler was not
   * read. Empty: it was read and attaches no guard, which is not a claim that it is public.
   */
  guards: z.array(GuardSchema).max(LIMITS.guardsPerEndpoint).optional(),
  /** `resource` only: a prefix every endpoint path of the resource starts with, e.g. `/v1`. */
  pathPrefix: z.string().min(1).max(LIMITS.shortText).optional(),
  /** `table` only: its columns in declaration order. Each defines `db:<table>/<column-slug>`. */
  columns: z.array(ColumnSchema).max(LIMITS.columns).optional(),
  /** `job` only, required: what starts it. */
  trigger: TriggerSchema.optional(),
  /** `job` only: how a failed run is tried again. */
  retry: RetrySchema.optional(),
  /** `job` only: how long a run may take, as declared (`30s`, `5m`). */
  timeout: z.string().min(1).max(60).optional(),
  /**
   * Added or worded by a person in the viewer, not checked against sources: always counted as
   * unresolved, and drawn so. A claim that is `manual` may cite nothing.
   */
  manual: z.literal(true).optional(),
  /**
   * The sources the node cited before a person changed its text: kept for whoever checks it
   * again, never counted as evidence. Only on a `manual` node.
   */
  priorSourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).optional(),
});

export const EdgeSchema = z.object({
  id,
  from: id,
  /** A node of this board. Exactly one of `to` and `toRef` is set. */
  to: id.optional(),
  /**
   * A ref defined on another board: a screen for `navigates`, an endpoint for `calls`; see
   * `REF_EDGE_KINDS`.
   */
  toRef: atlasRef.optional(),
  kind: z.enum(EDGE_KINDS).default("flow"),
  label: longText.optional(),
  sourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).default([]),
  /** `references` only: the column of `from` that holds the key, and the column of `to` it names. */
  fromColumn: z.string().min(1).max(64).optional(),
  toColumn: z.string().min(1).max(64).optional(),
  /** `references` only: how many rows on each side. */
  cardinality: z.enum(CARDINALITIES).optional(),
  /** Added or labelled by a person in the viewer; see the node's `manual`. */
  manual: z.literal(true).optional(),
  /** The sources the edge cited before a person changed it; only on a `manual` edge. */
  priorSourceIds: z.array(id).max(LIMITS.sourceIdsPerNode).optional(),
});

export const RepoSchema = z.object({
  url: httpsUrl.optional(),
  commit: z
    .string()
    .regex(/^[0-9a-fA-F]{7,40}$/, "repo.commit must be 7 to 40 hexadecimal characters")
    .optional(),
});

/**
 * A tag groups boards in the viewer (a role, an area of the app). Free text, so it can be in
 * the team's language, but one line with no leading or trailing space.
 */
const tag = z
  .string()
  .max(LIMITS.tag)
  .regex(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the class rejects control characters
    /^\S(?:[^\u0000-\u001f\u007f]*\S)?$/,
    "a tag is one line of text with no leading or trailing space",
  );

/** A board's tags: unique, at most 10. Also what the viewer sends to change them. */
export const BoardTagsSchema = z
  .array(tag)
  .max(LIMITS.tags)
  .refine((tags) => new Set(tags).size === tags.length, "tags must be unique");

/** Structural shape of a board, without cross-reference checks. */
export const BoardShape = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: shortText.min(1),
  question: shortText.min(1),
  repo: RepoSchema.optional(),
  generatedAt: z.iso.datetime({ offset: true }).optional(),
  /** Groups the board with others in the viewer's sidebar; unique, at most 10. */
  tags: BoardTagsSchema.optional(),
  groups: z.array(GroupSchema).max(LIMITS.groups).default([]),
  nodes: z.array(NodeSchema).min(1).max(LIMITS.nodes),
  edges: z.array(EdgeSchema).max(LIMITS.edges).default([]),
  sources: z.array(SourceSchema).max(LIMITS.sources).default([]),
});

export type Board = z.output<typeof BoardShape>;
export type BoardInput = z.input<typeof BoardShape>;
export type BoardNode = Board["nodes"][number];
export type BoardEdge = Board["edges"][number];
export type BoardGroup = Board["groups"][number];
export type BoardSource = Board["sources"][number];
export type EndpointGuard = NonNullable<BoardNode["guards"]>[number];
export type CodeSource = Extract<BoardSource, { kind: "code" }>;
export type FigmaSource = Extract<BoardSource, { kind: "figma" }>;
export type DocSource = Extract<BoardSource, { kind: "doc" }>;
export type LinkSource = Extract<BoardSource, { kind: "link" }>;
export type MockupSource = Extract<BoardSource, { kind: "mockup" }>;

/** The Figma URL for a Figma source, built from its validated parts. */
export function figmaUrl(source: Pick<FigmaSource, "fileKey" | "nodeId">): string {
  const nodeId = encodeURIComponent(source.nodeId.replaceAll(":", "-"));
  return `https://www.figma.com/design/${source.fileKey}?node-id=${nodeId}`;
}
