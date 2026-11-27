import { t } from "../i18n.ts";
import { Icon } from "./Icon.tsx";

/** The viewer's Back and Forward through the places visited. */
export interface BoardHistory {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/**
 * Back and Forward, as arrows: at the start of the tab bar, as in a browser, or in the board
 * toolbar where there is no tab bar.
 */
export function HistoryNav({
  history,
  className = "board-steps",
}: {
  history: BoardHistory;
  className?: string;
}) {
  return (
    <nav className={className} aria-label={t("editor.history")}>
      <button
        type="button"
        className="ghost icon-button"
        onClick={history.onBack}
        disabled={!history.canBack}
        aria-label={t("editor.back")}
        aria-keyshortcuts="Alt+ArrowLeft"
        title={t("editor.backHint", { key: "Alt+←" })}
      >
        <Icon name="historyBack" size={18} />
      </button>
      <button
        type="button"
        className="ghost icon-button"
        onClick={history.onForward}
        disabled={!history.canForward}
        aria-label={t("editor.forward")}
        aria-keyshortcuts="Alt+ArrowRight"
        title={t("editor.forwardHint", { key: "Alt+→" })}
      >
        <Icon name="historyForward" size={18} />
      </button>
    </nav>
  );
}
