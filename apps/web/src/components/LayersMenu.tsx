import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { LAYERS, type LayerId } from "../layers.ts";
import { Icon } from "./Icon.tsx";

interface LayersMenuProps {
  /** The layers this board has; the others are left out of the menu. */
  layers: readonly LayerId[];
  hidden: ReadonlySet<LayerId>;
  disabled: boolean;
  onToggle: (layer: LayerId) => void;
}

/**
 * A Layers button that opens a list of checkboxes, one per part of the board the reader can
 * hide. The menu stays open while toggling, so several layers can be turned off in a row; arrow
 * keys move, Esc closes.
 */
export function LayersMenu({ layers, hidden, disabled, onToggle }: LayersMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shown = LAYERS.filter((l) => layers.includes(l.id));
  const hiddenCount = shown.filter((l) => hidden.has(l.id)).length;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (shown.length === 0) return null;

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
        className={hiddenCount > 0 ? "ghost pressed" : "ghost"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        title={t("layers.title")}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="layers" />
        <span className="button-label">{t("layers.button")}</span>
        {hiddenCount > 0 ? (
          <span className="layer-badge">
            {hiddenCount}
            <span className="visually-hidden"> {t("layers.hidden")}</span>
          </span>
        ) : null}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div
          id={menuId}
          className="menu layers-menu"
          role="menu"
          aria-label={t("layers.button")}
          onKeyDown={onMenuKey}
        >
          {shown.map((layer, index) => {
            const visible = !hidden.has(layer.id);
            return (
              <button
                key={layer.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={visible}
                tabIndex={-1}
                className="menu-item layer-item"
                onClick={() => onToggle(layer.id)}
              >
                <span className={visible ? "layer-check on" : "layer-check"} aria-hidden="true">
                  {visible ? <Icon name="check" size={12} /> : null}
                </span>
                <span className="layer-text">
                  <span className="menu-item-label">{t(`layer.${layer.id}`)}</span>
                  <span className="menu-item-hint">{t(`layer.${layer.id}.hint`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
