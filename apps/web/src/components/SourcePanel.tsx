import { DEFINING_KINDS as DEFINERS } from "@groundboard/schema";
import { useEffect, useRef, useState } from "react";
import type { AtlasIndex, AtlasPlace } from "../api.ts";
import { boardDefiningRef } from "../atlas-nav.ts";
import { copyText, flowPrompt } from "../flow-hints.ts";
import { t } from "../i18n.ts";
import {
  type Citation,
  formatLocation,
  type Grounding,
  isCheckedCitation,
  isCodeCitation,
  isStale,
  type NodeCitations,
} from "../sources.ts";
import { Icon } from "./Icon.tsx";

interface SourcePanelProps {
  nodes: NodeCitations[];
  /** Set when the viewer serves an atlas: adds where each ref appears. */
  atlas?: AtlasIndex | null;
  /** The atlas board on screen, so the selected node is left out of its own list. */
  currentSlug?: string | null;
  /** Ids of the sources the board check found changed; empty for a pasted board. */
  staleSourceIds?: readonly string[];
  /** Refs of elements that call an API or change state with no flow yet. */
  missingFlows?: ReadonlySet<string>;
  onOpen?: (place: AtlasPlace) => void;
}

const NO_MISSING: ReadonlySet<string> = new Set();
const NO_STALE: ReadonlySet<string> = new Set();

const NONE_STALE: ReadonlySet<string> = new Set();
const groundingLabel = (grounding: Grounding) => t(`grounding.${grounding}`);

/** Node kinds that define a ref rather than point at one. */
/** Node kinds that define their ref (a screen, an element, a resource, an endpoint...). */
const DEFINING_KINDS: ReadonlySet<string> = DEFINERS;

/**
 * Whether a node points at its ref rather than defining it: a node of a kind that never defines
 * one, or a node of a defining kind that the atlas lists among the ref's uses, such as a screen's
 * copy of a shared layout's element.
 */
function pointsAtRef(
  node: Pick<NodeCitations, "kind" | "ref" | "nodeId" | "edgeId">,
  atlas: AtlasIndex | null,
  currentSlug: string | null,
): boolean {
  if (node.ref === undefined || node.edgeId !== undefined) return false;
  if (!DEFINING_KINDS.has(node.kind)) return true;
  const entry = atlas?.refs.find((r) => r.ref === node.ref);
  const isSelf = (p: AtlasPlace) =>
    p.slug === currentSlug && p.nodeId === node.nodeId && p.edgeId === undefined;
  return entry?.usedIn.some(isSelf) === true && !entry.definedIn.some(isSelf);
}

/** `dir/` and `file` of a repository path; `dir` is empty for a file at the root. */
function splitPath(path: string): { dir: string; file: string } {
  const at = path.lastIndexOf("/");
  return at < 0
    ? { dir: "", file: path }
    : { dir: path.slice(0, at + 1), file: path.slice(at + 1) };
}

/**
 * Where a source is. A file is shown by its name and lines first and its folder after, dimmed,
 * since the name is what tells two citations apart. A link when the scene gave a safe URL,
 * code text otherwise.
 */
function Location({ source }: { source: Citation }) {
  const url = "url" in source ? source.url : undefined;
  if (source.kind === undefined || source.kind === "code" || source.kind === "doc") {
    const { dir, file } = splitPath(source.path);
    const lines =
      source.endLine !== undefined && source.endLine !== source.line
        ? `${source.line}-${source.endLine}`
        : `${source.line}`;
    const name = (
      <>
        {source.kind === "doc" ? (
          <span className="source-kind">{t("sources.document")} </span>
        ) : null}
        <span className="source-file">{file}</span>
        <span className="source-line">:{lines}</span>
      </>
    );
    return (
      <>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" title={formatLocation(source)}>
            {name}
          </a>
        ) : (
          <code title={formatLocation(source)}>{name}</code>
        )}
        {dir ? (
          <span className="source-dir" title={source.path}>
            {dir}
          </span>
        ) : null}
      </>
    );
  }
  // Figma, link and mockup locations already start with their kind.
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {formatLocation(source)}
    </a>
  ) : (
    <code>{formatLocation(source)}</code>
  );
}

function SourceItem({ source, stale }: { source: Citation; stale: boolean }) {
  const quote = "quote" in source ? source.quote : undefined;
  return (
    <li className={stale ? "source stale" : "source"}>
      <div className="source-location">
        <Location source={source} />
        {source.kind === "link" && source.host ? (
          <span className="muted"> ({source.host})</span>
        ) : null}
        {source.kind === "mockup" && source.path !== undefined ? (
          <span className="muted"> {source.label}</span>
        ) : null}
        {isCheckedCitation(source) ? null : (
          <span className="muted"> {t("sources.notChecked")}</span>
        )}
      </div>
      {stale ? (
        <p className="stale-note">
          <Icon name="alert" />
          <span>{t("sources.staleNote")}</span>
        </p>
      ) : null}
      {quote ? <pre className="quote">{quote}</pre> : null}
    </li>
  );
}

/** The cited sources, code first and then the specification, each in board order. */
function SourceList({ sources, stale }: { sources: Citation[]; stale: ReadonlySet<string> }) {
  const ordered = [...sources.filter(isCodeCitation), ...sources.filter((s) => !isCodeCitation(s))];
  return (
    <ul className="source-list">
      {ordered.map((source) => (
        <SourceItem
          key={`${source.id}:${formatLocation(source)}`}
          source={source}
          stale={isStale(source, stale)}
        />
      ))}
    </ul>
  );
}

/** The screen a navigation or a ref chip points at, as one card that opens its board. */
function Target({
  target,
  atlas,
  currentSlug,
  onOpen,
}: {
  target: string;
  atlas: AtlasIndex | null;
  currentSlug: string | null;
  onOpen?: (place: AtlasPlace) => void;
}) {
  const defining = atlas ? boardDefiningRef(atlas, target) : null;
  const board = defining ? atlas?.boards.find((b) => b.slug === defining.slug) : undefined;
  return (
    <div className="panel-block">
      <h4 className="panel-section">{t("sources.leadsTo")}</h4>
      <div className="target-card">
        <div className="target-text">
          <span className="target-title">{board?.title ?? target}</span>
          <code className="target-ref">{target}</code>
        </div>
        {defining && onOpen && defining.slug !== currentSlug ? (
          <button type="button" className="secondary" onClick={() => onOpen(defining)}>
            {t("sources.open")}
            <Icon name="next" size={14} />
          </button>
        ) : defining ? (
          <span className="muted">{t("sources.onThisBoard")}</span>
        ) : atlas ? (
          <span className="muted">{t("sources.noDefinition")}</span>
        ) : null}
      </div>
    </div>
  );
}

interface Place extends AtlasPlace {
  title: string;
}

/**
 * The other boards that carry the ref, folded away: the boards that define it, then the nodes
 * that point at it. A node drawn the same way on many boards (a shared navigation bar) is one
 * line with how many boards it is on, opened to list them.
 */
function Appearances({
  node,
  refName,
  atlas,
  currentSlug,
  onOpen,
}: {
  node: NodeCitations;
  refName: string;
  atlas: AtlasIndex;
  currentSlug: string | null;
  onOpen: (place: AtlasPlace) => void;
}) {
  const entry = atlas.refs.find((r) => r.ref === refName);
  const isSelf = (p: AtlasPlace) =>
    p.slug === currentSlug &&
    (node.edgeId !== undefined
      ? p.edgeId === node.edgeId
      : p.nodeId === node.nodeId && p.edgeId === undefined);
  const titled = (p: AtlasPlace): Place => ({
    ...p,
    title: atlas.boards.find((b) => b.slug === p.slug)?.title ?? p.slug,
  });
  const defined = (entry?.definedIn ?? []).filter((p) => !isSelf(p)).map(titled);
  const used = (entry?.usedIn ?? []).filter((p) => !isSelf(p)).map(titled);
  const byNode = new Map<string, Place[]>();
  for (const place of used) byNode.set(place.nodeId, [...(byNode.get(place.nodeId) ?? []), place]);
  const total = defined.length + used.length;
  if (total === 0) return null;
  const definesIt =
    DEFINING_KINDS.has(node.kind) &&
    node.edgeId === undefined &&
    !pointsAtRef(node, atlas, currentSlug);

  const placeButton = (place: Place, via?: string) => (
    <button type="button" className="link" onClick={() => onOpen(place)}>
      {place.title}
      {via ? <span className="muted"> · {via}</span> : null}
    </button>
  );

  return (
    <details className="appearances panel-block">
      <summary>
        {definesIt ? t("sources.linkHere") : t("sources.sameTarget")}
        <span className="count">{total}</span>
      </summary>
      {defined.length > 0 ? (
        <>
          <h5>{t("sources.definedOn")}</h5>
          <ul>
            {defined.map((place) => (
              <li key={`defined:${place.slug}:${place.nodeId}`}>{placeButton(place)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {byNode.size > 0 ? (
        <>
          <h5>{definesIt ? t("sources.linkedFrom") : t("sources.alsoLinkedFrom")}</h5>
          <ul>
            {[...byNode].map(([nodeId, places]) =>
              places.length === 1 ? (
                <li key={`used:${nodeId}`}>{placeButton(places[0] as Place, nodeId)}</li>
              ) : (
                <li key={`used:${nodeId}`}>
                  <details className="appearance-group">
                    <summary>
                      <code>{nodeId}</code>
                      <span className="muted">
                        {" "}
                        {t("sources.onBoards", { count: places.length })}
                      </span>
                    </summary>
                    <ul>
                      {places.map((place) => (
                        <li key={`${place.slug}:${place.edgeId ?? ""}`}>{placeButton(place)}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              ),
            )}
          </ul>
        </>
      ) : null}
    </details>
  );
}

/**
 * Says that the selected element has no flow yet and offers the line to ask a developer for
 * one. When the browser will not copy (a sandboxed frame may refuse), the line is shown
 * selected so the reader can copy it by hand.
 */
function FlowHint({
  label,
  screen,
  refName,
}: {
  label?: string;
  screen?: string;
  refName: string;
}) {
  const prompt = flowPrompt({
    ref: refName,
    ...(label !== undefined ? { label } : {}),
    ...(screen !== undefined ? { screen } : {}),
  });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const fallback = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (copy === "failed") fallback.current?.select();
  }, [copy]);
  return (
    <div className="flow-hint panel-block">
      <h4 className="panel-section">{t("flowHint.missing")}</h4>
      <p className="flow-hint-explain">{t("flowHint.explain")}</p>
      <button
        type="button"
        className="flow-hint-copy"
        onClick={async () => setCopy((await copyText(prompt)) ? "copied" : "failed")}
      >
        <Icon name="copy" size={14} />
        {t("flowHint.copy")}
      </button>
      <span role="status" className="flow-hint-status">
        {copy === "copied"
          ? t("flowHint.copied")
          : copy === "failed"
            ? t("flowHint.copyFailed")
            : ""}
      </span>
      {copy === "failed" ? (
        <input
          ref={fallback}
          className="flow-hint-text"
          readOnly
          value={prompt}
          aria-label={t("flowHint.text")}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}

/** The title of the board on screen: an element is defined only on its own screen board. */
const screenTitle = (atlas: AtlasIndex | null, slug: string | null): string | undefined =>
  slug === null ? undefined : atlas?.boards.find((b) => b.slug === slug)?.title;

/** One selected node or arrow: what it is, what it cites, and where it leads. */
function NodeSources({
  node,
  atlas,
  currentSlug,
  stale,
  missingFlows,
  onOpen,
}: {
  node: NodeCitations;
  atlas: AtlasIndex | null;
  currentSlug: string | null;
  stale: ReadonlySet<string>;
  missingFlows: ReadonlySet<string>;
  onOpen?: (place: AtlasPlace) => void;
}) {
  const isEdge = node.edgeId !== undefined;
  // A defining kind (REF_DEFINERS) defines its ref unless it is a copy of a shared layout's
  // element; any other node, and an edge, points at one.
  const target = node.toRef ?? (pointsAtRef(node, atlas, currentSlug) ? node.ref : undefined);
  const refName = node.ref ?? node.toRef;
  // An arrow drawn as a numbered tag has no text of its own: it is named by where it starts.
  const title = node.label ?? (isEdge ? node.fromLabel : undefined);
  const screen = screenTitle(atlas, currentSlug);
  return (
    <section className="node-sources">
      <h3 className="node-head">
        {title ? <span className="node-label">{title}</span> : null}
        <span className="node-meta">
          <span className="node-id">{node.nodeId}</span>
          {node.kind ? <span className="kind">{node.role ?? node.kind}</span> : null}
        </span>
      </h3>
      {isEdge && node.fromLabel && node.label ? (
        <p className="node-from">
          {t("sources.from")} <strong>{node.fromLabel}</strong>
        </p>
      ) : null}
      {node.manual ? (
        <p className="grounding grounding-none" title={t("sources.manualTitle")}>
          {t("sources.manual")}
        </p>
      ) : node.grounding ? (
        <p className={`grounding grounding-${node.grounding}`}>{groundingLabel(node.grounding)}</p>
      ) : null}
      {node.column ? (
        <p className="action">
          <strong>{t("sources.column")}</strong> <code>{node.column}</code>
        </p>
      ) : null}
      {node.action ? (
        <p className="action">
          <strong>{t("sources.action")}</strong> {node.action}
        </p>
      ) : null}
      {node.unresolved ? (
        <p className="unresolved">
          <strong>{t("sources.unresolved")}</strong> {node.unresolved}
        </p>
      ) : null}
      {node.detail ? <p className="detail">{node.detail}</p> : null}

      <div className="panel-block">
        <h4 className="panel-section">
          {t("sources.evidence")}
          {node.sources.length > 0 ? <span className="count">{node.sources.length}</span> : null}
        </h4>
        {node.sources.length === 0 ? (
          <p className="muted">{t("sources.noSources")}</p>
        ) : (
          <SourceList sources={node.sources} stale={stale} />
        )}
      </div>

      {node.priorSources && node.priorSources.length > 0 ? (
        <div className="panel-block">
          <h4 className="panel-section" title={t("sources.recheckTitle")}>
            {t("sources.recheck")}
            <span className="count">{node.priorSources.length}</span>
          </h4>
          <SourceList sources={node.priorSources} stale={NONE_STALE} />
        </div>
      ) : null}

      {target !== undefined ? (
        <Target target={target} atlas={atlas} currentSlug={currentSlug} onOpen={onOpen} />
      ) : null}

      {node.kind === "element" &&
      node.edgeId === undefined &&
      node.ref !== undefined &&
      missingFlows.has(node.ref) ? (
        <FlowHint
          key={node.ref}
          refName={node.ref}
          {...(node.label !== undefined ? { label: node.label } : {})}
          {...(screen !== undefined ? { screen } : {})}
        />
      ) : null}

      {atlas && onOpen && refName !== undefined ? (
        <Appearances
          node={node}
          refName={refName}
          atlas={atlas}
          currentSlug={currentSlug}
          onOpen={onOpen}
        />
      ) : null}
    </section>
  );
}

/**
 * Cited sources of the selected nodes and arrows. Everything is rendered as React text
 * children, so quotes and paths from the scene are never interpreted as HTML.
 */
export function SourcePanel({
  nodes,
  atlas = null,
  currentSlug = null,
  staleSourceIds,
  missingFlows = NO_MISSING,
  onOpen,
}: SourcePanelProps) {
  const stale = staleSourceIds?.length ? new Set(staleSourceIds) : NO_STALE;
  return (
    <aside className="source-panel" aria-label={t("sources.panel")}>
      <div className="panel-head">
        <h2>{t("sources.title")}</h2>
        {nodes.length > 0 ? (
          <span className="count">{t("sources.selected", { count: nodes.length })}</span>
        ) : null}
      </div>
      {nodes.length === 0 ? (
        <div className="panel-empty">
          <span className="panel-empty-icon" aria-hidden="true">
            <Icon name="cursor" size={20} />
          </span>
          <p>{t("sources.empty")}</p>
        </div>
      ) : (
        nodes.map((node) => (
          <NodeSources
            key={`${node.edgeId ? "edge" : "node"}:${node.nodeId}`}
            node={node}
            atlas={atlas}
            currentSlug={currentSlug}
            stale={stale}
            missingFlows={missingFlows}
            onOpen={onOpen}
          />
        ))
      )}
    </aside>
  );
}
