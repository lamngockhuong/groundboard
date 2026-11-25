import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { LOCALES, type Locale, t, useLocale } from "../i18n.ts";
import { THEME_STYLES, type Theme, type ThemePreference, type ThemeStyle } from "../theme.ts";
import { Icon } from "./Icon.tsx";

const MODES: ReadonlyArray<{ id: ThemePreference; icon: "monitor" | "sun" | "moon" }> = [
  { id: "system", icon: "monitor" },
  { id: "light", icon: "sun" },
  { id: "dark", icon: "moon" },
];

interface SettingsMenuProps {
  preference: ThemePreference;
  /** The theme in effect, so the style swatches show the colours the reader will get. */
  theme: Theme;
  style: ThemeStyle;
  onPreference: (preference: ThemePreference) => void;
  onStyle: (style: ThemeStyle) => void;
  onLocale: (locale: Locale) => void;
  /** Every arrow of a board runs, not only the arrows of the selected node. */
  motionAll: boolean;
  onMotionAll: (on: boolean) => void;
  className?: string;
  /** Where the menu opens: under the button (a header), or above it (a sidebar's foot). */
  placement?: "below" | "above";
}

/**
 * The settings button: opens a menu to pick the interface language, light, dark or the
 * system's choice, one of the viewer's styles, and whether every arrow runs. The menu stays open while picking so
 * choices can be compared in place; arrow keys move, Esc closes.
 */
export function SettingsMenu({
  preference,
  theme,
  style,
  onPreference,
  onStyle,
  onLocale,
  motionAll,
  onMotionAll,
  className = "ghost icon-button",
  placement = "below",
}: SettingsMenuProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = t("settings.button", {
    language: LOCALES.find((l) => l.id === locale)?.label ?? locale,
    style: t(`style.${style}`),
    mode: t(`mode.${preference}.long`),
  });

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
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
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role=menuitemradio], [role=menuitemcheckbox]",
      ) ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        return move(at + 1);
      case "ArrowUp":
      case "ArrowLeft":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(items.length - 1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close(true);
      case "Tab":
        return close(false);
    }
  };

  return (
    <div className="menu-root theme-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? `${className} pressed` : className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="settings" size={18} />
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          className={`menu theme-menu theme-menu-${placement}`}
          role="menu"
          aria-label={t("settings.menu")}
          onKeyDown={onMenuKey}
        >
          <div className="theme-menu-heading" aria-hidden="true">
            {t("settings.language")}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a menu groups its menuitemradio items with role="group"; a fieldset is not allowed there. */}
          <div className="theme-modes" role="group" aria-label={t("settings.language")}>
            {LOCALES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={locale === option.id}
                tabIndex={-1}
                className="theme-mode"
                lang={option.id}
                onClick={() => onLocale(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="theme-menu-heading" aria-hidden="true">
            {t("settings.mode")}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a menu groups its menuitemradio items with role="group"; a fieldset is not allowed there. */}
          <div className="theme-modes" role="group" aria-label={t("settings.mode")}>
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={preference === mode.id}
                tabIndex={-1}
                className="theme-mode"
                onClick={() => onPreference(mode.id)}
              >
                <Icon name={mode.icon} size={15} />
                {t(`mode.${mode.id}`)}
              </button>
            ))}
          </div>
          <div className="theme-menu-heading" aria-hidden="true">
            {t("settings.style")}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a menu groups its menuitemradio items with role="group"; a fieldset is not allowed there. */}
          <div className="theme-styles" role="group" aria-label={t("settings.style")}>
            {THEME_STYLES.map((option) => {
              const swatch = option.swatches[theme];
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={style === option.id}
                  tabIndex={-1}
                  className="menu-item theme-style"
                  onClick={() => onStyle(option.id)}
                >
                  <span
                    className="theme-swatch"
                    aria-hidden="true"
                    style={{ background: swatch.surface, color: swatch.ink }}
                  >
                    <span className="theme-swatch-ink">Aa</span>
                    <span className="theme-swatch-accent" style={{ background: swatch.accent }} />
                  </span>
                  <span className="theme-style-text">
                    <span className="menu-item-label">{t(`style.${option.id}`)}</span>
                    <span className="menu-item-hint">{t(`style.${option.id}.hint`)}</span>
                  </span>
                  <span className="theme-style-check" aria-hidden="true">
                    {style === option.id ? <Icon name="check" size={16} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="theme-menu-heading" aria-hidden="true">
            {t("settings.motion")}
          </div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={motionAll}
            tabIndex={-1}
            className="menu-item theme-style"
            onClick={() => onMotionAll(!motionAll)}
          >
            <span className="theme-style-text">
              <span className="menu-item-label">{t("settings.motionAll")}</span>
              <span className="menu-item-hint">{t("settings.motionAllHint")}</span>
            </span>
            <span className="theme-style-check" aria-hidden="true">
              {motionAll ? <Icon name="check" size={16} /> : null}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
