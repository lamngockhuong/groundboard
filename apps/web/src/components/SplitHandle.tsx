import type { KeyboardEvent, PointerEvent } from "react";
import { t } from "../i18n.ts";
import { clampRatio, ratioAfterKey, SPLIT_RATIO } from "../split.ts";

/**
 * The handle between the two panes: drag it, or focus it and use ← and → (Shift for a bigger
 * step), Home and End; a double click goes back to half and half. While dragging, only the
 * `--split` property of the panes' container moves, so the two boards do not render again on
 * every move; the ratio is handed over once, on release.
 */
export function SplitHandle({
  ratio,
  onChange,
}: {
  /** The left pane's share of the width, in percent. */
  ratio: number;
  onChange: (ratio: number) => void;
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    if (!container) return;
    const box = container.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    let last = ratio;
    const move = (e: globalThis.PointerEvent) => {
      if (box.width <= 0) return;
      last = clampRatio(((e.clientX - box.left) / box.width) * 100);
      container.style.setProperty("--split", `${last}%`);
      handle.setAttribute("aria-valuenow", String(Math.round(last)));
    };
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("resizing");
      onChange(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    // Also when the handle leaves the page mid-drag (the window narrows into one pane).
    handle.addEventListener("lostpointercapture", end, { once: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ratioAfterKey(ratio, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resize handle; <hr> cannot take focus
    <div
      className="split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("split.resize")}
      aria-valuemin={SPLIT_RATIO.min}
      aria-valuemax={SPLIT_RATIO.max}
      aria-valuenow={Math.round(ratio)}
      tabIndex={0}
      title={t("split.resizeHint")}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(SPLIT_RATIO.initial)}
    />
  );
}
