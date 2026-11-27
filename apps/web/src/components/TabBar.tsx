import { type KeyboardEvent, useEffect, useRef } from "react";
import { t } from "../i18n.ts";
import type { Tab, TabsState } from "../tabs.ts";
import { type BoardHistory, HistoryNav } from "./HistoryNav.tsx";
import { Icon } from "./Icon.tsx";

interface TabBarProps {
  /** Back and Forward within the tab on screen, at the start of the bar as in a browser. */
  history?: BoardHistory;
  tabs: TabsState;
  title: (tab: Tab) => string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
}

/**
 * The boards open in the viewer, one tab each, above the board's toolbar. A tablist: the arrow
 * keys, Home and End move between tabs, Enter or Space shows the focused one (Enter on the tab
 * on screen pins it), Delete closes it.
 * A preview tab's title is set in italics and named "preview" to screen readers too; a tab
 * whose board cannot be shown carries a warning icon and words, not a colour alone.
 */
export function TabBar({ history, tabs, title, onSelect, onClose, onPin }: TabBarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusIndex = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);

  // The tab on screen scrolls into view when it changes, so a long row never hides it.
  useEffect(() => {
    if (tabs.activeId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tabs.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tabs.activeId]);

  const focusTab = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!buttons || buttons.length === 0) return;
    buttons[(index + buttons.length) % buttons.length]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, tab: Tab) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        return focusTab(index + 1);
      case "ArrowLeft":
        event.preventDefault();
        return focusTab(index - 1);
      case "Home":
        event.preventDefault();
        return focusTab(0);
      case "End":
        event.preventDefault();
        return focusTab(tabs.tabs.length - 1);
      case "Enter":
        // Enter on the tab on screen pins it, as a double click does.
        if (tab.id === tabs.activeId && tab.preview) {
          event.preventDefault();
          onPin(tab.id);
        }
        return;
      case "Delete":
        event.preventDefault();
        onClose(tab.id);
        // The focused tab may be gone: the focus goes to the tab now on screen, or to the
        // board area when no tab is left.
        requestAnimationFrame(() => {
          const next = listRef.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]');
          if (next) {
            next.focus();
            return;
          }
          const main = document.querySelector<HTMLElement>(".main-column main");
          if (main) {
            main.tabIndex = -1;
            main.focus();
          }
        });
        return;
    }
  };

  return (
    <div className="tab-bar">
      {history ? <HistoryNav history={history} className="tab-history" /> : null}
      <div ref={listRef} className="tab-list" role="tablist" aria-label={t("tabs.label")}>
        {tabs.tabs.map((tab, index) => {
          const selected = tab.id === tabs.activeId;
          const name = title(tab);
          // The tab on screen takes the focus; on the home, the first tab does.
          const focusable = focusIndex < 0 ? index === 0 : selected;
          const classes = ["tab", selected ? "active" : "", tab.preview ? "preview" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={tab.id} className={classes} data-tab-id={tab.id} role="presentation">
              <button
                type="button"
                role="tab"
                className="tab-button"
                aria-selected={selected}
                tabIndex={focusable ? 0 : -1}
                title={tab.preview ? `${name}\n${t("tabs.previewHint")}` : name}
                onClick={() => onSelect(tab.id)}
                onDoubleClick={() => onPin(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index, tab)}
              >
                {tab.error !== undefined ? <Icon name="alert" size={14} /> : null}
                <span className="tab-title">{name}</span>
                {tab.preview ? (
                  <span className="visually-hidden">, {t("tabs.preview")}</span>
                ) : null}
                {tab.error !== undefined ? (
                  <span className="visually-hidden">, {t("tabs.problem")}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={t("tabs.close", { title: name })}
                title={t("tabs.closeHint", { key: "Alt+W" })}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
