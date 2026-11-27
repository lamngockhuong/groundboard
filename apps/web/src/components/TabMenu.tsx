import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { Icon, type IconName } from "./Icon.tsx";

export interface TabMenuItem {
  label: string;
  icon: IconName;
  run: () => void;
}

interface TabMenuProps {
  /** Names the tab the menu acts on, for screen readers. */
  label: string;
  /** Where it opens: the pointer, or under the tab when the keyboard opened it. */
  at: { x: number; y: number };
  items: TabMenuItem[];
  /** Closes the menu; `refocus` puts the focus back on the tab, as Esc does. */
  onClose: (refocus: boolean) => void;
}

/**
 * The menu of one tab, opened by a right click on it, or by the ContextMenu key or Shift F10
 * while it has the focus. A menu: the arrow keys, Home and End move, Enter runs, Esc closes and
 * gives the focus back to the tab, Tab or a press elsewhere closes it.
 */
export function TabMenu({ label, at, items, onClose }: TabMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Kept inside the window: a menu opened near the right or bottom edge moves in.
  const [place, setPlace] = useState(at);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPlace({
      x: Math.max(4, Math.min(at.x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(at.y, window.innerHeight - height - 4)),
    });
  }, [at.x, at.y]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    itemRefs.current[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseRef.current(false);
    };
    const onBlur = () => onCloseRef.current(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => b !== null);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return move(index + 1);
      case "ArrowUp":
        return move(index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(buttons.length - 1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return onClose(true);
      case "Tab":
        event.preventDefault();
        return onClose(true);
    }
  };

  return (
    <div
      ref={menuRef}
      className="menu tab-menu"
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      // The browser's own menu stays closed over this one too.
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="menu-item"
          onClick={() => {
            // The item says where the focus goes: its action may move it to another pane.
            onClose(false);
            item.run();
          }}
        >
          <Icon name={item.icon} />
          <span className="menu-item-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The keys that open a context menu from the keyboard: ContextMenu, and Shift F10. */
export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

export const tabMenuLabel = (title: string) => t("tabs.menu", { title });
