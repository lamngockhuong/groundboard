import { type DragEvent, type FormEvent, useId, useState } from "react";
import { t, tNodes } from "../i18n.ts";
import { Icon } from "./Icon.tsx";

/** A file's text and its name, pasted text without one, or the bytes of a zip of boards. */
export type InputItem =
  | { text: string; fileName?: string }
  | { zip: ArrayBuffer; fileName: string };

const isZipFile = (file: File) =>
  file.name.toLowerCase().endsWith(".zip") ||
  file.type === "application/zip" ||
  file.type === "application/x-zip-compressed";

interface InputPanelProps {
  busy: boolean;
  /** Under an atlas: a slimmer panel, titled as a secondary way in. */
  compact?: boolean;
  /** Takes several files at once, from the picker or a drop. */
  multiple?: boolean;
  /** Takes zips of boards too: only the library, which keeps what it opens. */
  zip?: boolean;
  onInput: (items: InputItem[]) => void;
  onError: (message: string) => void;
}

const FORMAT_SLOTS = {
  board: <code>.board.json</code>,
  scene: <code>.excalidraw</code>,
};

/** Drop zone, file picker and paste box. Each hands raw text to `onInput`. */
export function InputPanel({
  busy,
  compact = false,
  multiple = false,
  zip = false,
  onInput,
  onError,
}: InputPanelProps) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputId = useId();
  const pasteId = useId();

  const readFiles = async (list: FileList | null | undefined) => {
    const files = [...(list ?? [])].slice(0, multiple ? undefined : 1);
    const items: InputItem[] = [];
    for (const file of files) {
      if (isZipFile(file) && !zip) {
        onError(t("zip.libraryOnly"));
        return;
      }
      try {
        items.push(
          isZipFile(file)
            ? { zip: await file.arrayBuffer(), fileName: file.name }
            : { text: await file.text(), fileName: file.name },
        );
      } catch (error) {
        onError(
          t("input.readFailed", {
            file: file.name,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return;
      }
    }
    if (items.length > 0) onInput(items);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFiles(event.dataTransfer.files);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onInput([{ text }]);
  };

  return (
    <section
      className={compact ? "input-panel compact" : "input-panel"}
      aria-labelledby={`${pasteId}-title`}
    >
      <div className="input-head">
        <h2 id={`${pasteId}-title`}>{compact ? t("app.openLocalBoard") : t("input.loadBoard")}</h2>
        <p className="muted">
          {tNodes("input.formats", FORMAT_SLOTS)}
          {zip ? <> {tNodes("zip.formats", { zip: <code>.zip</code> })}</> : null}
        </p>
      </div>
      <div className="input-body">
        {/* The whole zone is the file picker's label: click to browse, or drop a file on it. */}
        <label
          htmlFor={fileInputId}
          className={dragging ? "drop-zone dragging" : "drop-zone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="drop-icon" aria-hidden="true">
            <Icon name="upload" size={22} />
          </span>
          <span className="drop-title">{t("input.drop")}</span>
          <span className="muted">{tNodes("input.or", FORMAT_SLOTS)}</span>
          <span className="button secondary">{t("input.choose")}</span>
        </label>
        <input
          id={fileInputId}
          className="visually-hidden"
          type="file"
          accept={
            zip
              ? ".json,.excalidraw,.zip,application/json,application/zip"
              : ".json,.excalidraw,application/json"
          }
          multiple={multiple}
          onChange={(event) => {
            void readFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <form className="paste-box" onSubmit={handleSubmit}>
          <label htmlFor={pasteId}>{t("input.paste")}</label>
          <textarea
            id={pasteId}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            spellCheck={false}
            rows={compact ? 6 : 9}
            placeholder='{ "schemaVersion": 1, "title": "...", "nodes": [...] }'
          />
          <button type="submit" disabled={busy || text.trim() === ""}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? t("input.rendering") : t("input.render")}
          </button>
        </form>
      </div>
    </section>
  );
}
