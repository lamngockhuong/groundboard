import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { Icon, type IconName } from "./Icon.tsx";

export interface ExportItem {
  label: string;
  hint: string;
  icon: IconName;
  run: () => void;
}

/** One Export button that opens a menu of formats; arrow keys move, Esc closes. */
export function ExportMenu({ items, disabled }: { items: ExportItem[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => b !== null);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(buttons.length - 1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close(true);
      case "Tab":
        return close(false);
    }
  };

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        title={t("export.button")}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="download" />
        <span className="button-label">{t("export.button")}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div
          id={menuId}
          className="menu"
          role="menu"
          aria-label={t("export.button")}
          onKeyDown={onMenuKey}
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
                close(true);
                item.run();
              }}
            >
              <Icon name={item.icon} />
              <span className="menu-item-label">{item.label}</span>
              <span className="menu-item-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
