import { type KeyboardEvent, type PointerEvent, type Ref, useId, useState } from "react";
import type { AtlasBoardKind, AtlasIndex } from "../api.ts";
import {
  atlasTags,
  type BoardSection,
  filterBoards,
  orderedBoards,
  sectionsByKind,
  sectionsByTag,
  statusLabel,
} from "../atlas-nav.ts";
import { type Locale, t, tn } from "../i18n.ts";
import {
  readFlag,
  readList,
  SIDEBAR_BY_TAG_KEY,
  SIDEBAR_CLOSED_SECTIONS_KEY,
  saveFlag,
  saveValue,
} from "../prefs.ts";
import { formatRoute } from "../route.ts";
import { isNewTabClick, paletteKeyLabel } from "../shortcuts.ts";
import type { Theme, ThemePreference, ThemeStyle } from "../theme.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";

const GROUP_ICONS: Record<AtlasBoardKind, IconName> = {
  overview: "overview",
  screen: "screen",
  flow: "flow",
  api: "api",
  db: "database",
  batch: "clock",
};

interface SidebarProps {
  atlas: AtlasIndex;
  /** The atlas board on screen, marked as the current page. */
  currentSlug: string | null;
  /** True on the atlas home, which is then the current page. */
  atHome: boolean;
  /** Collapsed to a rail of icons; the drawer is never collapsed. */
  collapsed?: boolean;
  /** Shown as the mobile drawer: a close button replaces the collapse button. */
  drawer?: boolean;
  /** The settings menu's state: the language, light or dark, the viewer's style, and motion. */
  appearance: {
    preference: ThemePreference;
    theme: Theme;
    style: ThemeStyle;
    onPreference: (preference: ThemePreference) => void;
    onStyle: (style: ThemeStyle) => void;
    onLocale: (locale: Locale) => void;
    motionAll: boolean;
    onMotionAll: (on: boolean) => void;
  };
  filterRef?: Ref<HTMLInputElement>;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  onHome: () => void;
  /** Opens a local board file; absent on an exported page, which has no server to render it. */
  onOpenFile?: () => void;
  onOpenPalette: () => void;
  /** A board link was followed; the drawer closes. */
  onNavigate?: () => void;
  /** Removes a board from the list kept in this browser; absent when the list is not editable. */
  onRemove?: (slug: string) => void;
  /** Opens a board in a new tab of the viewer: Alt and a click, or the row's button. */
  onOpenInTab?: (slug: string) => void;
  /** The sidebar's width in pixels, when it can be resized by dragging its edge. */
  width?: number;
  /** A new width; `done` is true once the drag or key press is over, to store it. */
  onResize?: (width: number, done: boolean) => void;
}

/** Limits of the resizable sidebar, in pixels. */
export const SIDEBAR_WIDTH = { min: 200, max: 560, initial: 264 } as const;

const clampWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

/**
 * The drag handle on the sidebar's right edge: drag it, or focus it and use the arrow keys;
 * a double click puts the default width back.
 */
function ResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number, done: boolean) => void;
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    let last = width;
    const move = (e: globalThis.PointerEvent) => {
      last = clampWidth(e.clientX - left);
      onResize(last, false);
    };
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("resizing");
      onResize(last, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    // Also when the handle leaves the page mid-drag (the window narrows into the drawer layout).
    handle.addEventListener("lostpointercapture", end, { once: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const next =
      event.key === "ArrowLeft"
        ? width - step
        : event.key === "ArrowRight"
          ? width + step
          : event.key === "Home"
            ? SIDEBAR_WIDTH.min
            : event.key === "End"
              ? SIDEBAR_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    onResize(clampWidth(next), true);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resize handle; <hr> cannot take focus
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resize")}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title={t("sidebar.resizeHint")}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(SIDEBAR_WIDTH.initial, true)}
    />
  );
}

/** Why the filtered list is empty, naming the text and the tag it was filtered by. */
function noMatch(query: string, tag: string | null): string {
  if (query && tag) return t("sidebar.noMatchQueryTag", { query, tag });
  if (query) return t("sidebar.noMatchQuery", { query });
  if (tag) return t("sidebar.noMatchTag", { tag });
  return t("sidebar.noMatch");
}

/** The atlas tree: every board by group, with its status, plus the viewer's global actions. */
export function Sidebar({
  atlas,
  currentSlug,
  atHome,
  collapsed = false,
  drawer = false,
  appearance,
  filterRef,
  onToggleCollapsed,
  onClose,
  onHome,
  onOpenFile,
  onOpenPalette,
  onNavigate,
  onRemove,
  onOpenInTab,
  width,
  onResize,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [byTag, setByTag] = useState(() => readFlag(SIDEBAR_BY_TAG_KEY, true));
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () => new Set(readList(SIDEBAR_CLOSED_SECTIONS_KEY)),
  );
  const filterId = useId();
  const tags = atlasTags(atlas);
  // A tag picked before the atlas was reloaded may be gone.
  const activeTag = tag !== null && tags.some((entry) => entry.tag === tag) ? tag : null;
  const boards = filterBoards(orderedBoards(atlas), query, activeTag);
  const grouped = byTag && tags.length > 0;
  const sections: BoardSection[] = grouped ? sectionsByTag(boards) : sectionsByKind(boards);
  // While filtering, every section with a match is open, so no match hides in a closed one.
  const filtering = query.trim() !== "" || activeTag !== null;

  const toggleSection = (key: string) => {
    const next = new Set(closed);
    if (!next.delete(key)) next.add(key);
    setClosed(next);
    saveValue(SIDEBAR_CLOSED_SECTIONS_KEY, [...next]);
  };

  const pickGrouping = (value: boolean) => {
    setByTag(value);
    saveFlag(SIDEBAR_BY_TAG_KEY, value);
  };

  if (collapsed) {
    return (
      <nav className="sidebar sidebar-rail" aria-label={t("common.atlas")}>
        <button
          type="button"
          className="ghost icon-button"
          onClick={onToggleCollapsed}
          aria-label={t("sidebar.expand")}
          aria-expanded={false}
          title={t("sidebar.expand")}
        >
          <Icon name="sidebar" size={18} />
        </button>
        <a
          className="rail-link"
          href={formatRoute({ view: "home" })}
          onClick={onHome}
          aria-label={t("common.atlasHome")}
          aria-current={atHome ? "page" : undefined}
          title={t("common.atlasHome")}
        >
          <Icon name="map" size={18} />
        </a>
        <button
          type="button"
          className="ghost icon-button"
          onClick={onOpenPalette}
          aria-label={t("common.searchAll")}
          title={t("sidebar.searchShortcut", { key: paletteKeyLabel() })}
        >
          <Icon name="search" size={18} />
        </button>
        <div className="sidebar-foot">
          {onOpenFile ? (
            <button
              type="button"
              className="ghost icon-button"
              onClick={onOpenFile}
              aria-label={t("sidebar.openFileLong")}
              title={t("sidebar.openFileLong")}
            >
              <Icon name="upload" size={18} />
            </button>
          ) : null}
          <SettingsMenu {...appearance} placement="above" />
        </div>
      </nav>
    );
  }

  return (
    <nav className="sidebar" aria-label={t("common.atlas")}>
      <div className="sidebar-brand">
        <span className="logo" aria-hidden="true">
          <Icon name="logo" size={16} />
        </span>
        {/* The page heading on wide screens, where the sidebar replaces the header. */}
        {drawer ? (
          <span className="sidebar-name">groundboard</span>
        ) : (
          <h1 className="sidebar-name">groundboard</h1>
        )}
        {drawer ? (
          <button
            type="button"
            className="ghost icon-button"
            onClick={onClose}
            aria-label={t("sidebar.closeMenu")}
            title={t("sidebar.closeMenu")}
          >
            <Icon name="close" size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="ghost icon-button"
            onClick={onToggleCollapsed}
            aria-label={t("sidebar.collapse")}
            aria-expanded={true}
            title={t("sidebar.collapse")}
          >
            <Icon name="sidebar" size={18} />
          </button>
        )}
      </div>

      <div className="sidebar-search">
        <Icon name="search" />
        <label htmlFor={filterId} className="visually-hidden">
          {t("sidebar.filter")}
        </label>
        <input
          ref={filterRef}
          id={filterId}
          type="search"
          placeholder={t("sidebar.filter")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <span className="kbd" aria-hidden="true">
          /
        </span>
      </div>

      <button type="button" className="secondary palette-button" onClick={onOpenPalette}>
        <Icon name="search" />
        <span>{t("sidebar.searchEverything")}</span>
        <span className="kbd" aria-hidden="true">
          {paletteKeyLabel()}
        </span>
      </button>

      {tags.length > 0 ? (
        <div className="tag-bar">
          <fieldset className="segmented">
            <legend className="visually-hidden">{t("sidebar.groupBy")}</legend>
            <button
              type="button"
              className="segmented-option"
              aria-pressed={!grouped}
              onClick={() => pickGrouping(false)}
            >
              {t("sidebar.byKind")}
            </button>
            <button
              type="button"
              className="segmented-option"
              aria-pressed={grouped}
              onClick={() => pickGrouping(true)}
            >
              {t("sidebar.byTag")}
            </button>
          </fieldset>
        </div>
      ) : null}

      <div className="sidebar-scroll">
        <a
          className="nav-item nav-home"
          href={formatRoute({ view: "home" })}
          onClick={() => {
            onHome();
            onNavigate?.();
          }}
          aria-current={atHome ? "page" : undefined}
        >
          <Icon name="map" />
          <span className="nav-label">{t("common.atlasHome")}</span>
        </a>

        {tags.length > 0 ? (
          <ul className="tag-chips" aria-label={t("sidebar.tagFilter")}>
            {tags.map((entry) => (
              <li key={entry.tag}>
                <button
                  type="button"
                  className="tag-chip"
                  aria-pressed={activeTag === entry.tag}
                  onClick={() => setTag(activeTag === entry.tag ? null : entry.tag)}
                  title={tn("sidebar.tagCount", entry.count, { tag: entry.tag })}
                >
                  {entry.tag}
                  <span className="count">{entry.count}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {atlas.boards.length > 0 && boards.length === 0 ? (
          <p className="nav-empty">{noMatch(query.trim(), activeTag)}</p>
        ) : null}

        {sections.map((section, index) => {
          const open = filtering || !closed.has(section.key);
          // From the index: a tag may hold spaces, which would split an id reference.
          const headingId = `${filterId}-s${index}`;
          const listId = `${headingId}-list`;
          return (
            <section key={section.key} className="nav-group" aria-labelledby={headingId}>
              <h2 className="nav-group-title">
                <button
                  type="button"
                  id={headingId}
                  className="nav-group-toggle"
                  aria-expanded={open}
                  aria-controls={open ? listId : undefined}
                  disabled={filtering}
                  onClick={() => toggleSection(section.key)}
                >
                  <span className={open ? "chevron open" : "chevron"} aria-hidden="true">
                    <Icon name="next" size={12} />
                  </span>
                  <Icon name={section.kind ? GROUP_ICONS[section.kind] : "tag"} size={14} />
                  <span className="nav-group-name">{section.title}</span>
                  <span className="count">{section.boards.length}</span>
                </button>
              </h2>
              {open ? (
                <ul id={listId}>
                  {section.boards.map((board) => {
                    const actions = (onOpenInTab ? 1 : 0) + (onRemove ? 1 : 0);
                    return (
                      <li
                        key={board.slug}
                        className={
                          actions === 0
                            ? undefined
                            : actions === 2
                              ? "nav-row nav-row-2"
                              : "nav-row"
                        }
                      >
                        <a
                          className="nav-item"
                          href={formatRoute({ view: "board", slug: board.slug })}
                          aria-current={board.slug === currentSlug ? "page" : undefined}
                          onClick={(event) => {
                            // Alt and a click: a tab of the viewer. Ctrl, Cmd and the middle
                            // button stay the browser's, which opens a tab of its own.
                            if (onOpenInTab && isNewTabClick(event)) {
                              event.preventDefault();
                              onOpenInTab(board.slug);
                            }
                            onNavigate?.();
                          }}
                          title={board.title}
                        >
                          <span className={`dot dot-${board.status}`} aria-hidden="true" />
                          <span className="nav-label">{board.title}</span>
                          {board.sequence ? (
                            <span
                              className="nav-sequence"
                              role="img"
                              aria-label={t("sequence.badge")}
                              title={t("sequence.badge")}
                            >
                              <Icon name="sequence" size={12} />
                            </span>
                          ) : null}
                          {board.status !== "ok" ? (
                            <span className={`nav-status status-text-${board.status}`}>
                              {statusLabel(board.status)}
                            </span>
                          ) : null}
                        </a>
                        {actions > 0 ? (
                          <span className="nav-actions">
                            {onOpenInTab ? (
                              <button
                                type="button"
                                className="ghost icon-button nav-action"
                                onClick={() => {
                                  onOpenInTab(board.slug);
                                  onNavigate?.();
                                }}
                                aria-label={t("tabs.openInTab", { title: board.title })}
                                title={t("tabs.openInTabHint")}
                              >
                                <Icon name="tabNew" size={14} />
                              </button>
                            ) : null}
                            {onRemove ? (
                              <button
                                type="button"
                                className="ghost icon-button nav-action"
                                onClick={() => onRemove(board.slug)}
                                aria-label={t("library.remove", { title: board.title })}
                                title={t("library.remove", { title: board.title })}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="sidebar-foot">
        {onOpenFile ? (
          <button type="button" className="secondary" onClick={onOpenFile}>
            <Icon name="upload" />
            {t("sidebar.openFile")}
          </button>
        ) : null}
        <SettingsMenu {...appearance} className="secondary icon-button" placement="above" />
      </div>
      {width !== undefined && onResize ? <ResizeHandle width={width} onResize={onResize} /> : null}
    </nav>
  );
}
