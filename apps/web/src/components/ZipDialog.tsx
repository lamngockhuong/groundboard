import { useEffect, useId, useRef, useState } from "react";
import { buildBoardsZip, downloadBlob, type ZipSource } from "../download.ts";
import { t } from "../i18n.ts";
import type { Scene } from "../input.ts";
import { Icon } from "./Icon.tsx";
import { Modal } from "./Modal.tsx";

interface ZipDialogProps {
  /** Where the boards come from; read when the download starts. */
  source: () => ZipSource | Promise<ZipSource>;
  fileName: string;
  /** Asked for a token when the server refuses the download; the dialog closes. */
  onUnauthorized: (rejected: boolean) => void;
  onClose: () => void;
}

/**
 * Draws a scene as PNG with Excalidraw's own export, light whatever the viewer's theme. PNG,
 * not SVG: the SVG export subsets fonts with code the page's CSP refuses to evaluate.
 */
async function sceneToPng(scene: Scene): Promise<Uint8Array> {
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    elements: scene.elements as never,
    appState: { ...scene.appState, exportBackground: true, theme: "light" } as never,
    files: scene.files as never,
    mimeType: "image/png",
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders a board in the browser for the zip; the error text when it cannot. */
async function renderForZip(board: Record<string, unknown>): Promise<Scene | { error: string }> {
  const { renderBoard } = await import("../render-client.ts");
  const result = await renderBoard(board);
  if (result.status === "ok") return result.scene;
  if (result.status === "error") return { error: result.message };
  const first = result.issues[0];
  return { error: first ? `${first.path}: ${first.message}` : "invalid" };
}

/**
 * Downloads every board as a zip: the board files alone (the default, fast), or with each
 * board rendered and drawn, which happens here one board at a time and can be cancelled.
 */
export function ZipDialog({ source, fileName, onUnauthorized, onClose }: ZipDialogProps) {
  const [choice, setChoice] = useState<"boards" | "extras" | "drafts">("boards");
  const extras = choice === "extras";
  /** Boards with a draft in this browser; the "edited only" choice appears when there are any. */
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    void Promise.resolve(source()).then((found) =>
      setDraftCount(found.kind === "library" ? 0 : (found.drafts?.length ?? 0)),
    );
  }, [source]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const name = useId();

  // Closing the dialog stops a download in progress.
  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError(null);
    setProgress(null);
    try {
      const result = await buildBoardsZip(await source(), {
        extras,
        onlyDrafts: choice === "drafts",
        toImage: sceneToPng,
        render: renderForZip,
        signal: abort.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (abort.signal.aborted) return;
      switch (result.status) {
        case "ok":
          downloadBlob(
            new Blob([result.zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
            `${fileName}.zip`,
          );
          onClose();
          return;
        case "unauthorized":
          onUnauthorized(result.rejected);
          onClose();
          return;
        case "error":
          setError(t("zip.failed", { error: result.message }));
          break;
      }
    } catch (caught) {
      if (abort.signal.aborted) return;
      setError(
        t("zip.failed", { error: caught instanceof Error ? caught.message : String(caught) }),
      );
    }
    setRunning(false);
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setProgress(null);
  };

  const options = [
    { value: "boards" as const, label: t("zip.optionBoards"), hint: t("zip.optionBoardsHint") },
    { value: "extras" as const, label: t("zip.optionExtras"), hint: t("zip.optionExtrasHint") },
    ...(draftCount > 0
      ? [
          {
            value: "drafts" as const,
            label: t("zip.optionDrafts"),
            hint: t("zip.optionDraftsHint"),
          },
        ]
      : []),
  ];

  return (
    <Modal className="zip-dialog" label={t("zip.dialogTitle")} onClose={onClose}>
      <div className="zip-dialog-head">
        <h2>{t("zip.dialogTitle")}</h2>
        <button
          type="button"
          className="ghost icon-button"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <fieldset className="zip-options" disabled={running}>
        <legend className="visually-hidden">{t("zip.dialogTitle")}</legend>
        {options.map((option) => (
          <label key={option.value} className="zip-option">
            <input
              type="radio"
              name={name}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
            />
            <span>
              <span className="zip-option-label">{option.label}</span>
              <span className="muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {running ? (
        <div className="zip-progress" role="status">
          <span className="spinner" aria-hidden="true" />
          {progress && progress.total > 0 ? (
            <>
              <progress max={progress.total} value={progress.done} />
              <span>{t("zip.progress", { done: progress.done, total: progress.total })}</span>
            </>
          ) : (
            <span>{t("zip.preparing")}</span>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="zip-actions">
        {running ? (
          <button type="button" className="secondary" onClick={cancel}>
            {t("common.cancel")}
          </button>
        ) : (
          <button type="button" onClick={() => void start()}>
            <Icon name="download" />
            {t("zip.start")}
          </button>
        )}
      </div>
    </Modal>
  );
}
