import { t } from "../i18n.ts";
import { DELAY_RANGE, type PresentationView } from "../use-presentation.ts";
import { Icon } from "./Icon.tsx";

interface PresentControlsProps {
  view: PresentationView;
  delay: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onExit: () => void;
  onDelay: (seconds: number) => void;
}

const SECONDS = Array.from(
  { length: DELAY_RANGE.max - DELAY_RANGE.min + 1 },
  (_, i) => DELAY_RANGE.min + i,
);

/** The floating bar of a presentation: back, play or pause, forward, the step, speed, exit. */
export function PresentControls({
  view,
  delay,
  onPrev,
  onNext,
  onTogglePlay,
  onExit,
  onDelay,
}: PresentControlsProps) {
  const last = view.index >= view.total - 1;
  return (
    // Back and forward at either end are marked unavailable, not disabled, so the focus stays
    // on them instead of falling to the page.
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a form's fieldset.
    <div className="present-controls" role="group" aria-label={t("present.controls")}>
      <button
        type="button"
        className="ghost icon-button"
        onClick={onPrev}
        aria-disabled={view.index === 0}
        aria-label={t("present.prev")}
        title={t("present.prev")}
      >
        <Icon name="prev" size={18} />
      </button>
      <button
        type="button"
        className="ghost icon-button"
        onClick={onTogglePlay}
        aria-label={view.playing ? t("present.pause") : t("present.play")}
        title={view.playing ? t("present.pause") : t("present.play")}
      >
        <Icon name={view.playing ? "pause" : "play"} size={18} />
      </button>
      <button
        type="button"
        className="ghost icon-button"
        onClick={onNext}
        aria-disabled={last}
        aria-label={t("present.next")}
        title={t("present.next")}
      >
        <Icon name="next" size={18} />
      </button>
      <span className="present-counter" aria-live="polite">
        {t("present.counter", { n: view.index + 1, total: view.total })}
      </span>
      <label className="present-delay" title={t("present.delay")}>
        <span className="visually-hidden">{t("present.delay")}</span>
        <select value={delay} onChange={(event) => onDelay(Number(event.currentTarget.value))}>
          {SECONDS.map((n) => (
            <option key={n} value={n}>
              {t("present.seconds", { n })}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ghost icon-button"
        onClick={onExit}
        aria-label={t("present.exit")}
        title={t("present.exit")}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
