import { useId } from "react";
import type { AtlasBoard, AtlasIndex } from "../api.ts";
import { atlasGrounding, groupSingular, needsAttention, statusLabel } from "../atlas-nav.ts";
import { getLocale, t, tn } from "../i18n.ts";
import { formatRoute } from "../route.ts";
import { describeStamp } from "../stamp.ts";
import { Icon } from "./Icon.tsx";

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className={tone ? `stat stat-${tone}` : "stat"}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/** Why a board needs a look, in words. */
function reason(board: AtlasBoard): string {
  if (board.status === "invalid") {
    return board.issues.length > 0
      ? tn("home.notValidIssues", board.issues.length)
      : t("home.notValid");
  }
  return tn("home.staleSources", board.staleSourceIds.length);
}

const kindLabel = (board: AtlasBoard) => groupSingular(board.kind).toLocaleLowerCase(getLocale());

/** Grounding of every claim in the atlas, as a bar with a legend in words. */
function Grounding({ atlas }: { atlas: AtlasIndex }) {
  const headingId = useId();
  const { code, spec, none } = atlasGrounding(atlas);
  const total = code + spec + none;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <section className="card grounding-card" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId}>{t("home.grounding")}</h3>
        <span className="muted">{tn("home.claims", total)}</span>
      </div>
      <div className="grounding-bar" aria-hidden="true">
        <span className="fill-code" style={{ width: pct(code) }} />
        <span className="fill-spec" style={{ width: pct(spec) }} />
        <span className="fill-none" style={{ width: pct(none) }} />
      </div>
      <p className="grounding-legend">
        <span>
          <span className="swatch fill-code" aria-hidden="true" />
          {t("grounding.code")} <strong>{code}</strong>
        </span>
        <span>
          <span className="swatch fill-spec" aria-hidden="true" />
          {t("grounding.spec")} <strong>{spec}</strong>
        </span>
        <span>
          <span className="swatch fill-none" aria-hidden="true" />
          {t("grounding.none")} <strong>{none}</strong>
        </span>
      </p>
    </section>
  );
}

/** The boards opened in this browser, shown on the home page in place of a server's atlas. */
export interface LibraryHome {
  /** Nothing opened yet: the sample boards are listed. */
  sample: boolean;
  /** Storage failed, so the list lasts for this page load. */
  memoryOnly: boolean;
  onOpenFile: () => void;
  onClear: () => void;
}

function Attention({ atlas, library }: { atlas: AtlasIndex; library: boolean }) {
  const headingId = useId();
  const boards = needsAttention(atlas);
  return (
    <section className="card attention" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId}>{t("home.attention")}</h3>
        {boards.length > 0 ? <span className="count">{boards.length}</span> : null}
      </div>
      {boards.length === 0 ? (
        <p className="attention-clear">
          <Icon name="check" />
          {library ? t("library.allValid") : t("home.allClear")}
        </p>
      ) : (
        <ul>
          {boards.map((board) => (
            <li key={board.slug}>
              <span className={`status status-${board.status}`}>{statusLabel(board.status)}</span>
              <a href={formatRoute({ view: "board", slug: board.slug })}>{board.title}</a>
              <span className="muted">
                {kindLabel(board)} · {reason(board)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The atlas home: how many boards are in which state, how the claims are grounded, what to fix. */
export function AtlasHome({ atlas, library }: { atlas: AtlasIndex; library?: LibraryHome }) {
  const titleId = useId();
  const count = (status: AtlasBoard["status"]) =>
    atlas.boards.filter((b) => b.status === status).length;

  return (
    <section className="atlas-home" aria-labelledby={titleId}>
      <div className="atlas-head">
        <h2 id={titleId}>
          {library ? t(library.sample ? "library.sampleTitle" : "library.title") : t("home.title")}
        </h2>
        <p className="muted">
          {library
            ? t(library.sample ? "library.sampleBody" : "library.subtitle")
            : t("home.subtitle")}
        </p>
        {library?.memoryOnly ? (
          <p className="snapshot-note">
            <Icon name="alert" />
            <span>{t("library.memoryOnly")}</span>
          </p>
        ) : null}
        {library ? (
          <div className="library-actions">
            <button type="button" onClick={library.onOpenFile}>
              <Icon name="upload" />
              {t("library.openFiles")}
            </button>
            {library.sample ? null : (
              <button type="button" className="secondary" onClick={library.onClear}>
                {t("library.clear")}
              </button>
            )}
          </div>
        ) : null}
        {atlas.exported ? (
          <p className="snapshot-note">
            <Icon name="alert" />
            <span>
              {describeStamp(atlas.exported)}. {t("common.snapshotNote")}
            </span>
          </p>
        ) : null}
      </div>

      {atlas.boards.length === 0 ? (
        <p className="empty">{t("home.empty")}</p>
      ) : (
        <>
          <div className="stats">
            <Stat value={atlas.boards.length} label={t("home.boards")} />
            {count("ok") > 0 ? (
              <Stat
                value={count("ok")}
                label={library ? t("library.valid") : statusLabel("ok")}
                tone="ok"
              />
            ) : null}
            {count("stale") > 0 ? (
              <Stat value={count("stale")} label={statusLabel("stale")} tone="stale" />
            ) : null}
            {count("invalid") > 0 ? (
              <Stat value={count("invalid")} label={statusLabel("invalid")} tone="invalid" />
            ) : null}
          </div>
          <Grounding atlas={atlas} />
          <Attention atlas={atlas} library={library !== undefined} />
        </>
      )}

      {atlas.problems.length > 0 ? (
        <details className="atlas-problems">
          <summary>
            <Icon name="alert" />
            {tn("home.problems", atlas.problems.length)}
          </summary>
          <ul>
            {atlas.problems.map((problem) => (
              <li key={`${problem.path}\u0000${problem.message}`}>
                <code>{problem.path || "(atlas)"}</code> {problem.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
