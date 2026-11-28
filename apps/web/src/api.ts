import {
  ATLAS_BOARD_KINDS,
  type AtlasBoardKind,
  ELEMENT_ROLES,
  type ElementRole,
  HANDLER_SHAPES,
  type HandlerShape,
} from "@groundboard/schema";
import { t } from "./i18n.ts";

const isHandlerShape = (value: unknown): value is HandlerShape =>
  (HANDLER_SHAPES as readonly unknown[]).includes(value);

import { type Scene, toScene } from "./input.ts";
import { isStaticMode } from "./mode.ts";
import { SLUG_PATTERN } from "./route.ts";

export interface Issue {
  path: string;
  message: string;
}

export const HEALTH_ENDPOINT = "/healthz";
export const ATLAS_ENDPOINT = "/api/atlas";
export const ATLAS_BOARD_ENDPOINT = "/api/atlas/boards/";
export const ATLAS_ZIP_ENDPOINT = "/api/atlas/export.zip";
/** Where an exported page reads its atlas, relative to the page. */
export const STATIC_ATLAS_URL = "./data/atlas.json";
export const STATIC_BOARD_URL = "./data/boards/";
const TOKEN_KEY = "groundboard.token";

// Fallback for when sessionStorage is unavailable (privacy mode, sandboxed frames).
let memoryToken: string | null = null;

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

/** A bearer token must be printable ASCII to fit in an HTTP header. */
export function isValidToken(token: string): boolean {
  return /^[\x21-\x7e]+$/.test(token);
}

/** Stores a trimmed token; returns false, storing nothing, when it cannot be sent as a header. */
export function saveToken(raw: string): boolean {
  const token = raw.trim();
  if (!isValidToken(token)) return false;
  memoryToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage is blocked; the in-memory copy lasts for this page load.
  }
  return true;
}

/**
 * Drops the stored token only if it is still the one a refused request carried, so a 401 to
 * an old request cannot erase a token the user entered since.
 */
function clearTokenIfSent(sent: string | null): void {
  if (sent !== null && readToken() === sent) clearToken();
}

export function clearToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === "string") : [];
}

function toIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((issue) => ({
    path: typeof issue.path === "string" ? issue.path : String(issue.path ?? ""),
    message: typeof issue.message === "string" ? issue.message : t("api.invalidValue"),
  }));
}

function errorText(body: unknown): string | null {
  return isRecord(body) && typeof body.error === "string" ? body.error : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// --- Screen atlas -------------------------------------------------------------------------

export type { AtlasBoardKind };
export type AtlasBoardStatus = "ok" | "stale" | "invalid";

export interface AtlasBoard {
  slug: string;
  title: string;
  kind: AtlasBoardKind;
  status: AtlasBoardStatus;
  layoutFrom: string[];
  /** Labels that group the board with others in the sidebar; empty when it has none. */
  tags: string[];
  /** A flow board drawn as a sequence diagram. */
  sequence?: true;
  /** Sources that cannot be checked offline: Figma, links, mockups without a file. */
  uncheckedSources: number;
  /** Claims by grounding: backed by code, by the specification only, or unresolved. */
  grounding: { code: number; spec: number; none: number };
  /** JSON paths of the spec-only claims, at most 50. */
  specOnly: string[];
  specOnlyTruncated: boolean;
  staleSourceIds: string[];
  warnings: string[];
  issues: Issue[];
}

export interface AtlasPlace {
  slug: string;
  nodeId: string;
  edgeId?: string;
  /**
   * On a definition: the text the defining node shows. Absent in indexes written before it was
   * carried, and on refs a node derives (a table's columns).
   */
  label?: string;
  /** On the definition of an element: what it is drawn as (button, link, ...). */
  role?: ElementRole;
}

export interface AtlasRef {
  ref: string;
  definedIn: AtlasPlace[];
  usedIn: AtlasPlace[];
  /**
   * An element that calls an API or changes state, or an endpoint whose handler has logic, so a
   * flow should cover it.
   */
  needsFlow?: true;
  /** An endpoint whose handler has logic: the board that should explain it. */
  flowShape?: HandlerShape;
}

/** When an exported atlas checked its sources, and against which commit. */
export interface ExportStamp {
  /** ISO 8601, UTC. */
  checkedAt: string;
  /** Short commit hash, or null outside git. */
  commit: string | null;
  /** The working tree had uncommitted changes. */
  dirty: boolean;
  version: string;
}

export interface AtlasIndex {
  boards: AtlasBoard[];
  refs: AtlasRef[];
  problems: Issue[];
  /** Set by `groundboard export`; the server never sends it. */
  exported?: ExportStamp;
  /**
   * The server writes into board files (tags, layout, content): a local `serve --atlas`, never
   * an export. Elsewhere edits stay in the browser as drafts.
   */
  tagsEditable?: boolean;
  /** Tells atlases apart on one origin, so their drafts never mix. */
  atlasId?: string;
}

/** What every atlas call can end in besides its own success. */
export type Failure =
  | { status: "unauthorized"; rejected: boolean }
  | { status: "error"; message: string };

export type AtlasResult = { status: "ok"; atlas: AtlasIndex } | Failure;

/** Frames of a board that cite a Figma frame, and how many have a cached reference image. */
export interface ReferenceCount {
  frames: number;
  cached: number;
}

export type AtlasBoardResult =
  | {
      status: "ok";
      scene: Scene;
      stale: boolean;
      staleSourceIds: string[];
      warnings: string[];
      references: ReferenceCount;
    }
  | { status: "invalid"; issues: Issue[]; warnings: string[] }
  | { status: "not-found" }
  | Failure;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

function toGrounding(value: unknown): AtlasBoard["grounding"] {
  const g = isRecord(value) ? value : {};
  return { code: count(g.code), spec: count(g.spec), none: count(g.none) };
}

const isKind = (kind: unknown): kind is AtlasBoardKind =>
  (ATLAS_BOARD_KINDS as readonly unknown[]).includes(kind);
const STATUSES: AtlasBoardStatus[] = ["ok", "stale", "invalid"];

const isRole = (role: unknown): role is ElementRole =>
  (ELEMENT_ROLES as readonly unknown[]).includes(role);

function toPlaces(value: unknown): AtlasPlace[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((p) => typeof p.slug === "string" && typeof p.nodeId === "string")
    .map((p) => ({
      slug: p.slug as string,
      nodeId: p.nodeId as string,
      ...(typeof p.edgeId === "string" ? { edgeId: p.edgeId } : {}),
      ...(typeof p.label === "string" && p.label.trim() !== "" ? { label: p.label } : {}),
      ...(isRole(p.role) ? { role: p.role } : {}),
    }));
}

/** Reads the export stamp; null when any part of it is missing or of the wrong type. */
function toStamp(value: unknown): ExportStamp | null {
  if (!isRecord(value)) return null;
  const { checkedAt, commit, dirty, version } = value;
  if (typeof checkedAt !== "string" || Number.isNaN(Date.parse(checkedAt))) return null;
  if (commit !== null && (typeof commit !== "string" || !/^[0-9a-f]{4,64}$/.test(commit))) {
    return null;
  }
  if (typeof dirty !== "boolean" || typeof version !== "string") return null;
  return { checkedAt, commit, dirty, version };
}

/** Reads an atlas index defensively; unknown or malformed entries are dropped. */
export function toAtlas(value: unknown): AtlasIndex | null {
  if (!isRecord(value) || !Array.isArray(value.boards) || !Array.isArray(value.refs)) return null;
  const boards = value.boards
    .filter(isRecord)
    .filter((b) => typeof b.slug === "string" && typeof b.title === "string")
    .map((b) => ({
      slug: b.slug as string,
      title: b.title as string,
      // A kind this viewer does not know is not passed off as a flow: the board is listed as
      // one it cannot show, and says why.
      kind: isKind(b.kind) ? b.kind : "flow",
      status:
        isKind(b.kind) && STATUSES.includes(b.status as AtlasBoardStatus)
          ? (b.status as AtlasBoardStatus)
          : "invalid",
      layoutFrom: strings(b.layoutFrom),
      ...(b.sequence === true ? { sequence: true as const } : {}),
      tags: [...new Set(strings(b.tags))],
      uncheckedSources: count(b.uncheckedSources),
      grounding: toGrounding(b.grounding),
      specOnly: strings(b.specOnly),
      specOnlyTruncated: b.specOnlyTruncated === true,
      staleSourceIds: strings(b.staleSourceIds),
      warnings: strings(b.warnings),
      issues: isKind(b.kind)
        ? toIssues(b.issues)
        : [{ path: "", message: t("api.unknownBoardKind", { kind: String(b.kind) }) }],
    }));
  const refs = value.refs
    .filter(isRecord)
    .filter((r) => typeof r.ref === "string")
    .map((r) => ({
      ref: r.ref as string,
      definedIn: toPlaces(r.definedIn),
      usedIn: toPlaces(r.usedIn),
      ...(r.needsFlow === true ? { needsFlow: true as const } : {}),
      ...(isHandlerShape(r.flowShape) ? { flowShape: r.flowShape } : {}),
    }));
  const exported = toStamp(value.exported);
  const atlasId =
    typeof value.atlasId === "string" && /^[0-9a-f]{16,64}$/.test(value.atlasId)
      ? value.atlasId
      : undefined;
  return {
    boards,
    refs,
    problems: toIssues(value.problems),
    ...(atlasId ? { atlasId } : {}),
    ...(exported ? { exported } : {}),
    // An exported page has no server to write to, whatever its data says.
    ...(value.tagsEditable === true && !exported ? { tagsEditable: true } : {}),
  };
}

/** GETs `url` with the stored token; a 401 becomes `unauthorized`, a network error `error`. */
async function getJson(
  url: string,
  fetchImpl: typeof fetch,
  staticMode = false,
): Promise<{ response: Response; body: unknown } | Failure> {
  // An exported page reads files next to it: there is no server to send a token to.
  const token = staticMode ? null : readToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      message: staticMode
        ? t("api.exportUnreadable", { detail })
        : t("api.unreachable", { detail }),
    };
  }
  if (!staticMode && response.status === 401) {
    clearTokenIfSent(token);
    return { status: "unauthorized", rejected: token !== null };
  }
  return { response, body: await readJson(response) };
}

function failureFor(response: Response, body: unknown): Failure {
  switch (response.status) {
    case 429:
      return { status: "error", message: t("api.tooManyRequests") };
    case 503:
      return {
        status: "error",
        message: errorText(body) ?? t("api.busy"),
      };
    default:
      return {
        status: "error",
        message: errorText(body) ?? t("api.httpStatus", { status: response.status }),
      };
  }
}

/** Whether this server serves an atlas. Open without a token; false on any failure. */
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
  staticMode = isStaticMode(),
  hosted = import.meta.env.VITE_GROUNDBOARD_HOSTED === "1",
): Promise<{ atlas: boolean }> {
  // An exported page always has an atlas, and no server to ask.
  if (staticMode) return { atlas: true };
  // The hosted editor is static files on a site whose `/healthz`, if any, is not groundboard's.
  if (hosted) return { atlas: false };
  try {
    const response = await fetchImpl(HEALTH_ENDPOINT);
    const body = await readJson(response);
    return { atlas: response.ok && isRecord(body) && body.atlas === true };
  } catch {
    return { atlas: false };
  }
}

export async function fetchAtlas(
  fetchImpl: typeof fetch = fetch,
  staticMode = isStaticMode(),
): Promise<AtlasResult> {
  const got = await getJson(staticMode ? STATIC_ATLAS_URL : ATLAS_ENDPOINT, fetchImpl, staticMode);
  if ("status" in got) return got;
  if (staticMode && got.response.status !== 200) {
    return { status: "error", message: t("api.noAtlasData") };
  }
  if (got.response.status !== 200) return failureFor(got.response, got.body);
  const atlas = toAtlas(got.body);
  return atlas
    ? { status: "ok", atlas }
    : {
        status: "error",
        message: staticMode ? t("api.exportDataUnreadable") : t("api.unexpectedAtlas"),
      };
}

export type TagsResult = { status: "ok"; tags: string[] } | Failure;

/** Replaces the tags of an atlas board in its file. Never throws. */
export async function saveBoardTags(
  slug: string,
  tags: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<TagsResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "error", message: t("api.invalidBoardName") };
  const token = readToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(`${ATLAS_BOARD_ENDPOINT}${encodeURIComponent(slug)}/tags`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ tags }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: t("api.unreachable", { detail }) };
  }
  const body = await readJson(response);
  if (response.status === 401) {
    clearTokenIfSent(token);
    return { status: "unauthorized", rejected: token !== null };
  }
  if (response.status === 200 && isRecord(body)) return { status: "ok", tags: strings(body.tags) };
  return failureFor(response, body);
}

/** A rendered atlas board, as the server returns it with HTTP 200. */
function toRenderedBoard(body: unknown): AtlasBoardResult {
  const scene = isRecord(body) ? toScene(body.scene) : null;
  if (!scene || !isRecord(body)) {
    return { status: "error", message: t("api.unexpectedBoard") };
  }
  return {
    status: "ok",
    scene,
    stale: body.status === "stale",
    staleSourceIds: strings(body.staleSourceIds),
    warnings: toWarnings(body.warnings),
    references: {
      frames: count(isRecord(body.references) ? body.references.frames : 0),
      cached: count(isRecord(body.references) ? body.references.cached : 0),
    },
  };
}

const toInvalidBoard = (body: unknown): AtlasBoardResult => ({
  status: "invalid",
  issues: toIssues(isRecord(body) ? body.issues : null),
  warnings: toWarnings(isRecord(body) ? body.warnings : null),
});

/**
 * An exported board: `data/boards/<slug>.json` holds what the server would have answered, an
 * invalid board as `{ status: "invalid", issues }`. A slug the server would refuse is never
 * fetched, so no URL leaves `data/boards/`.
 */
async function fetchStaticBoard(slug: string, fetchImpl: typeof fetch): Promise<AtlasBoardResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "not-found" };
  const got = await getJson(`${STATIC_BOARD_URL}${slug}.json`, fetchImpl, true);
  if ("status" in got) return got;
  const { response, body } = got;
  if (response.status === 404) return { status: "not-found" };
  if (response.status !== 200) {
    return {
      status: "error",
      message: t("api.boardFileUnreadable", { status: response.status }),
    };
  }
  return isRecord(body) && body.status === "invalid" ? toInvalidBoard(body) : toRenderedBoard(body);
}

export async function fetchAtlasBoard(
  slug: string,
  fetchImpl: typeof fetch = fetch,
  staticMode = isStaticMode(),
): Promise<AtlasBoardResult> {
  if (staticMode) return fetchStaticBoard(slug, fetchImpl);
  const got = await getJson(`${ATLAS_BOARD_ENDPOINT}${encodeURIComponent(slug)}`, fetchImpl);
  if ("status" in got) return got;
  const { response, body } = got;
  switch (response.status) {
    case 200:
      return toRenderedBoard(body);
    case 404:
      return { status: "not-found" };
    case 422:
      return toInvalidBoard(body);
    default:
      return failureFor(response, body);
  }
}

// --- Board files, for zips ------------------------------------------------------------------

export type AtlasZipResult = { status: "ok"; bytes: ArrayBuffer } | Failure;

/**
 * The served atlas as one zip of its board files, rendered scenes added with `scenes`: one
 * request, whatever the number of boards. Never throws but on abort.
 */
export async function fetchAtlasZip(
  scenes: boolean,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AtlasZipResult> {
  const token = readToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(`${ATLAS_ZIP_ENDPOINT}${scenes ? "?include=excalidraw" : ""}`, {
      headers,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: t("api.unreachable", { detail }) };
  }
  if (response.status === 401) {
    clearTokenIfSent(token);
    return { status: "unauthorized", rejected: token !== null };
  }
  if (response.status !== 200) return failureFor(response, await readJson(response));
  return { status: "ok", bytes: await response.arrayBuffer() };
}

/** An exported board's file as written, and its rendered scene when it rendered. */
export type StaticBoardFile =
  | {
      status: "ok";
      source: string | null;
      /** The layout overlay as written beside the board, when it had one. */
      overlay: string | null;
      scene: Scene | null;
      invalid: boolean;
    }
  | Failure;

/** Reads `data/boards/<slug>.json` of an exported page for its embedded board file. */
export async function fetchStaticBoardFile(
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StaticBoardFile> {
  if (!SLUG_PATTERN.test(slug)) return { status: "error", message: t("api.invalidBoardName") };
  const got = await getJson(`${STATIC_BOARD_URL}${slug}.json`, fetchImpl, true);
  if ("status" in got) return got;
  const { response, body } = got;
  if (response.status !== 200 || !isRecord(body)) {
    return {
      status: "error",
      message: t("api.boardFileUnreadable", { status: response.status }),
    };
  }
  const invalid = body.status === "invalid";
  return {
    status: "ok",
    source: typeof body.source === "string" ? body.source : null,
    overlay: typeof body.overlay === "string" ? body.overlay : null,
    scene: invalid ? null : toScene(body.scene),
    invalid,
  };
}

// --- Editing an atlas board ------------------------------------------------------------------

/** A board file and its layout overlay as written, with what identifies each version. */
export interface BoardFiles {
  source: string;
  /** SHA-256 of `source`: what a draft was made from. */
  sourceEtag: string;
  /** The overlay file's text, or null when there is none. */
  overlay: string | null;
  /** SHA-256 of the overlay file, or null when there is none; sent back with a save. */
  overlayEtag: string | null;
}

export type BoardFilesResult = ({ status: "ok" } & BoardFiles) | { status: "not-found" } | Failure;

/** SHA-256 of a text's UTF-8 bytes, in hex: the ETag of a board or overlay file. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** GETs a text file of the API; null on 404. */
async function getText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: "ok"; text: string | null } | Failure> {
  const token = readToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: t("api.unreachable", { detail }) };
  }
  if (response.status === 401) {
    clearTokenIfSent(token);
    return { status: "unauthorized", rejected: token !== null };
  }
  if (response.status === 404) return { status: "ok", text: null };
  if (response.status !== 200) return failureFor(response, await readJson(response));
  return { status: "ok", text: await response.text() };
}

/**
 * The board file and overlay of an atlas board, to edit: from the server (its overlay route
 * exists only on a loopback bind; elsewhere there is none to read) or, on an exported page,
 * from the board's JSON. ETags are computed here, on the bytes received.
 */
export async function fetchBoardFiles(
  slug: string,
  fetchImpl: typeof fetch = fetch,
  staticMode = isStaticMode(),
): Promise<BoardFilesResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "not-found" };
  let source: string | null;
  let overlay: string | null;
  if (staticMode) {
    const read = await fetchStaticBoardFile(slug, fetchImpl);
    if (read.status !== "ok") return read;
    source = read.source;
    overlay = read.overlay;
  } else {
    const base = `${ATLAS_BOARD_ENDPOINT}${encodeURIComponent(slug)}`;
    const sourceRead = await getText(`${base}/source`, fetchImpl);
    if (sourceRead.status !== "ok") return sourceRead;
    const overlayRead = await getText(`${base}/overlay`, fetchImpl);
    if (overlayRead.status !== "ok") return overlayRead;
    source = sourceRead.text;
    overlay = overlayRead.text;
  }
  if (source === null) return { status: "not-found" };
  return {
    status: "ok",
    source,
    sourceEtag: await sha256Hex(source),
    overlay,
    overlayEtag: overlay === null ? null : await sha256Hex(overlay),
  };
}

export type SaveResult =
  | { status: "ok"; etag: string }
  /** The file changed since it was read; `etag` is what it is now, null when it is gone. */
  | { status: "conflict"; etag: string | null }
  | { status: "invalid"; issues: Issue[] }
  | Failure;

/** Writes a board file or its overlay on a local `serve --atlas`. Never throws. */
export async function saveAtlasFile(
  slug: string,
  file: "overlay" | "board",
  value: unknown,
  expectedEtag: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "error", message: t("api.invalidBoardName") };
  const token = readToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${ATLAS_BOARD_ENDPOINT}${encodeURIComponent(slug)}${file === "overlay" ? "/overlay" : ""}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ [file]: value, expectedEtag }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: t("api.unreachable", { detail }) };
  }
  const body = await readJson(response);
  if (response.status === 401) {
    clearTokenIfSent(token);
    return { status: "unauthorized", rejected: token !== null };
  }
  if (response.status === 200 && isRecord(body) && typeof body.etag === "string") {
    return { status: "ok", etag: body.etag };
  }
  if (response.status === 409 && isRecord(body) && "etag" in body) {
    return { status: "conflict", etag: typeof body.etag === "string" ? body.etag : null };
  }
  if (response.status === 422 && isRecord(body) && Array.isArray(body.issues)) {
    return { status: "invalid", issues: toIssues(body.issues) };
  }
  return failureFor(response, body);
}
