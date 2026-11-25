import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { Icon } from "./Icon.tsx";

/** The schema's limits on a board's tags. */
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;

/**
 * A tag as typed, made valid: one line, no leading or trailing space. Null when nothing is
 * left or it is too long.
 */
export function cleanTag(raw: string): string | null {
  const tag = raw.replace(/\s+/g, " ").trim();
  return tag === "" || tag.length > MAX_TAG_LENGTH ? null : tag;
}

interface TagEditorProps {
  tags: readonly string[];
  /** Every tag the atlas uses, offered while typing. */
  suggestions: readonly string[];
  /** Absent when the board cannot be edited: the tags are then only shown. */
  onSave?: (tags: string[]) => Promise<string | null>;
}

/**
 * The board's tags in the toolbar. Where the server can write them, a button opens a small
 * editor: type a tag and press Enter, remove one with its ×, then Save.
 */
export function TagEditor({ tags, suggestions, onSave }: TagEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const inputId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (tags.length === 0 && !onSave) return null;

  const start = () => {
    setDraft([...tags]);
    setText("");
    setError(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  /** Adds what is typed; false, with a reason shown, when it cannot be added. */
  const add = (): boolean => {
    if (text.trim() === "") return true;
    const tag = cleanTag(text);
    if (tag === null) {
      setError(t("tags.tooLong", { max: MAX_TAG_LENGTH }));
      return false;
    }
    if (draft.includes(tag)) {
      setText("");
      return true;
    }
    if (draft.length >= MAX_TAGS) {
      setError(t("tags.tooMany", { max: MAX_TAGS }));
      return false;
    }
    setDraft([...draft, tag]);
    setText("");
    setError(null);
    return true;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSave) return;
    // A tag still in the box when Save is pressed is meant to be saved too.
    const pending = text.trim() === "" ? null : cleanTag(text);
    if (text.trim() !== "" && !add()) return;
    const next = pending && !draft.includes(pending) ? [...draft, pending] : draft;
    setSaving(true);
    const failure = await onSave(next);
    setSaving(false);
    if (failure) setError(failure);
    else close();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && text === "" && draft.length > 0) {
      setDraft(draft.slice(0, -1));
    }
  };

  const offered = suggestions.filter((s) => !draft.includes(s));

  return (
    <div className="menu-root board-tags" ref={rootRef}>
      {tags.map((tag) => (
        <span key={tag} className="badge board-tag">
          <Icon name="tag" size={12} />
          {tag}
        </span>
      ))}
      {onSave ? (
        <button
          ref={buttonRef}
          type="button"
          className="ghost tag-edit-button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => (open ? close() : start())}
          title={t("tags.editTitle")}
        >
          <Icon name="tag" size={14} />
          {tags.length > 0 ? t("tags.edit") : t("tags.add")}
        </button>
      ) : null}
      {open && onSave ? (
        <form
          className="menu tag-editor"
          role="dialog"
          aria-label={t("tags.dialog")}
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <ul className="tag-editor-list" aria-label={t("tags.list")}>
            {draft.map((tag) => (
              <li key={tag} className="tag-chip-static">
                {tag}
                <button
                  type="button"
                  className="ghost tag-remove"
                  onClick={() => setDraft(draft.filter((t) => t !== tag))}
                  aria-label={t("tags.remove", { tag })}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
            {draft.length === 0 ? <li className="muted">{t("tags.none")}</li> : null}
          </ul>
          <label htmlFor={inputId} className="visually-hidden">
            {t("tags.new")}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            list={listId}
            value={text}
            maxLength={MAX_TAG_LENGTH + 20}
            placeholder={t("tags.placeholder")}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKey}
          />
          <datalist id={listId}>
            {offered.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {error ? (
            <p className="tag-editor-error" role="alert">
              {error}
            </p>
          ) : (
            <p className="muted tag-editor-hint">{t("tags.hint")}</p>
          )}
          <div className="tag-editor-actions">
            <button type="button" className="secondary" onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
