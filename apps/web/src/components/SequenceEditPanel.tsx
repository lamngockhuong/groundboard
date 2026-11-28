import {
  FRAGMENT_KINDS,
  type FragmentKind,
  MESSAGE_TYPES,
  PARTICIPANT_CATEGORIES,
} from "@groundboard/schema";
import { useEffect, useId, useRef, useState } from "react";
import { type EditResult, type RawBoard, setNodeText } from "../board-edit.ts";
import { t, tn } from "../i18n.ts";
import {
  addMessage,
  addParticipant,
  type MessageMove,
  messageMove,
  moveMessage,
  moveParticipant,
  participantRemoval,
  removeMessage,
  removeParticipant,
  setFragmentKind,
  setMessage,
  setOperandGuard,
  setParticipantCategory,
  splitOperand,
  unwrapFragment,
  wrapMessages,
} from "../sequence-edit.ts";
import { isSequenceMoveKey } from "../shortcuts.ts";
import { Icon } from "./Icon.tsx";

/**
 * The edit panel of a sequence board: what the selected participant, message, messages or
 * operand can become. Every edit goes through `apply`, which refuses one that would break the
 * board; Alt and an arrow moves the selected message (up, down) or participant (left, right).
 */

type Item = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const list = (board: RawBoard, key: "nodes" | "edges" | "fragments") =>
  Array.isArray(board[key]) ? (board[key] as Item[]) : [];

interface Props {
  board: RawBoard;
  selection: { nodes: string[]; edges: string[]; operands: string[] };
  apply: (edit: (board: RawBoard) => EditResult) => Promise<string | null>;
}

function Field({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const id = useId();
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="edit-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className="edit-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const categories = () =>
  PARTICIPANT_CATEGORIES.map((c) => ({ value: c, label: t(`participant.${c}`) }));
const messageTypes = () => MESSAGE_TYPES.map((m) => ({ value: m, label: t(`message.${m}`) }));
const fragmentKinds = () => FRAGMENT_KINDS.map((k) => ({ value: k, label: t(`fragment.${k}`) }));

/** `alt [authorized]`: a fragment named by its kind and the guard of the operand at hand. */
function fragmentName(board: RawBoard, operandId: string | undefined): string {
  if (operandId === undefined) return "";
  for (const fragment of list(board, "fragments")) {
    const operand = (fragment.operands as Item[] | undefined)?.find((o) => o.id === operandId);
    if (operand) return `${str(fragment.kind)}${operand.guard ? ` [${str(operand.guard)}]` : ""}`;
  }
  return operandId;
}

/** The operands that contain an operand, outermost first, it included. */
function operandsAround(board: RawBoard, operandId: string | undefined): string[] {
  const out: string[] = [];
  const fragments = list(board, "fragments");
  let current = operandId;
  while (current !== undefined && !out.includes(current)) {
    out.unshift(current);
    const owner = fragments.find((f) =>
      (f.operands as Item[] | undefined)?.some((o) => o.id === current),
    );
    current = owner ? str(owner.parentOperandId) || undefined : undefined;
  }
  return out;
}

/** What the next move up or down will do to the message's fragments, said before it happens. */
function moveNote(board: RawBoard, move: MessageMove | null, dir: "up" | "down"): string | null {
  if (move === null || move.kind === "swap") return null;
  const name = fragmentName(board, move.operandId);
  if (move.kind === "enter") return t(`sequenceEdit.${dir}Enters`, { fragment: name });
  return t(`sequenceEdit.${dir}Leaves`, { fragment: name });
}

/** A form that adds a message: who sends it to whom, its label and how it is sent. */
function AddMessageForm({
  participants,
  from,
  to,
  onAdd,
  title,
}: {
  participants: Item[];
  from: string;
  to: string;
  onAdd: (spec: {
    from: string;
    to: string;
    label: string;
    messageType: string;
  }) => Promise<string | null>;
  title: string;
}) {
  const [source, setSource] = useState(from);
  const [target, setTarget] = useState(to);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("sync");
  const options = participants.map((p) => ({ value: str(p.id), label: str(p.label) }));
  return (
    <details className="edit-subsection">
      <summary>{title}</summary>
      <Choice
        label={t("sequenceEdit.from")}
        value={source}
        options={options}
        onChange={setSource}
      />
      <Choice label={t("sequenceEdit.to")} value={target} options={options} onChange={setTarget} />
      <label className="edit-field">
        <span>{t("editPanel.field.label")}</span>
        <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
      </label>
      <Choice
        label={t("sequenceEdit.type")}
        value={type}
        options={messageTypes()}
        onChange={setType}
      />
      <button
        type="button"
        onClick={() =>
          void onAdd({ from: source, to: target, label, messageType: type }).then((failed) => {
            if (failed === null) setLabel("");
          })
        }
      >
        {t("sequenceEdit.addMessage")}
      </button>
    </details>
  );
}

/** A form that wraps the selected messages in a fragment of a chosen kind and condition. */
function WrapForm({ onWrap }: { onWrap: (kind: FragmentKind, guard: string) => void }) {
  const [kind, setKind] = useState<FragmentKind>("opt");
  const [guard, setGuard] = useState("");
  return (
    <details className="edit-subsection">
      <summary>{t("sequenceEdit.wrap")}</summary>
      <Choice
        label={t("sequenceEdit.wrapKind")}
        value={kind}
        options={fragmentKinds()}
        onChange={(value) => setKind(value as FragmentKind)}
      />
      <label className="edit-field">
        <span>{t("sequenceEdit.guard")}</span>
        <input value={guard} onChange={(event) => setGuard(event.currentTarget.value)} />
      </label>
      <button type="button" onClick={() => onWrap(kind, guard)}>
        {t("sequenceEdit.wrapButton")}
      </button>
    </details>
  );
}

/** A form that adds a participant, after the selected one or at the end. */
function AddParticipantForm({
  title,
  onAdd,
}: {
  title: string;
  onAdd: (label: string, category: string) => Promise<string | null>;
}) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("system");
  return (
    <details className="edit-subsection">
      <summary>{title}</summary>
      <label className="edit-field">
        <span>{t("editPanel.field.label")}</span>
        <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
      </label>
      <Choice
        label={t("sequenceEdit.category")}
        value={category}
        options={categories()}
        onChange={setCategory}
      />
      <button
        type="button"
        onClick={() =>
          void onAdd(label, category).then((failed) => {
            if (failed === null) setLabel("");
          })
        }
      >
        {t("sequenceEdit.addParticipant")}
      </button>
    </details>
  );
}

/** One move button: its label, its key, and what it does. */
function MoveButton({
  label,
  keys,
  shortcut,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  /** The key as people read it (`⌥ ↑`), and as `aria-keyshortcuts` names it (`Alt+ArrowUp`). */
  keys: string;
  shortcut: string;
  icon: "back" | "next" | "chevronDown" | "chevronUp";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${keys})`}
      aria-keyshortcuts={shortcut}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

export function SequenceEditPanel({ board, selection, apply }: Props) {
  const nodes = list(board, "nodes");
  const edges = list(board, "edges");
  const participants = nodes.filter((n) => n.kind === "participant");
  const byId = new Map(nodes.map((n) => [str(n.id), n]));
  const picked = selection.nodes.map((id) => byId.get(id)).filter((n) => n?.kind === "participant");
  const participant = picked.length === 1 && selection.edges.length === 0 ? picked[0] : undefined;
  const pair = picked.length === 2 && selection.edges.length === 0 ? picked : null;
  const pickedMessages = edges.filter(
    (e) => e.kind === "message" && selection.edges.includes(str(e.id)),
  );
  const message =
    pickedMessages.length === 1 && selection.nodes.length === 0 ? pickedMessages[0] : undefined;
  // An operand picked from the panel, for the keyboard: the canvas cannot focus a frame.
  const selectionKey = JSON.stringify(selection);
  const [pickedOperand, setPickedOperand] = useState<{ key: string; id: string } | null>(null);
  const fromPanel = pickedOperand?.key === selectionKey ? pickedOperand.id : undefined;
  const operandId =
    selection.operands.length === 1 && selection.nodes.length + selection.edges.length === 0
      ? selection.operands[0]
      : fromPanel;
  const fragment =
    operandId === undefined
      ? undefined
      : list(board, "fragments").find((f) =>
          (f.operands as Item[] | undefined)?.some((o) => o.id === operandId),
        );
  const operand = (fragment?.operands as Item[] | undefined)?.find((o) => o.id === operandId);

  // Alt and an arrow moves the selected message or participant wherever the keyboard is, the
  // canvas included, ahead of Excalidraw's own use of the keys.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event: KeyboardEvent) => {
    const key = isSequenceMoveKey(event);
    if (key === null) return;
    if (message && (key === "up" || key === "down")) {
      event.preventDefault();
      event.stopPropagation();
      void apply((b) => moveMessage(b, str(message.id), key === "up" ? -1 : 1));
    } else if (participant && (key === "left" || key === "right")) {
      event.preventDefault();
      event.stopPropagation();
      void apply((b) => moveParticipant(b, str(participant.id), key === "left" ? -1 : 1));
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);
  /** The operands around the selected message, outermost first, to edit from the keyboard. */
  const around = message ? operandsAround(board, str(message.operandId) || undefined) : [];

  return (
    <div className="sequence-edit">
      {participant ? (
        <section className="edit-section" aria-label={t("nodeKind.participant")}>
          <p className="edit-meta">
            <code>{str(participant.id)}</code>{" "}
            <span className="badge">
              {t(`participant.${str(participant.category) as "system"}`)}
            </span>
            {participant.manual ? <span className="badge">{t("sources.manual")}</span> : null}
          </p>
          <Field
            label={t("editPanel.field.label")}
            value={str(participant.label)}
            onCommit={(value) =>
              void apply((b) => setNodeText(b, str(participant.id), "label", value))
            }
          />
          <Choice
            label={t("sequenceEdit.category")}
            value={str(participant.category)}
            options={categories()}
            onChange={(value) =>
              void apply((b) => setParticipantCategory(b, str(participant.id), value))
            }
          />
          <div className="edit-actions">
            <MoveButton
              label={t("sequenceEdit.moveLeft")}
              keys="⌥ ←"
              shortcut="Alt+ArrowLeft"
              icon="back"
              onClick={() => void apply((b) => moveParticipant(b, str(participant.id), -1))}
            />
            <MoveButton
              label={t("sequenceEdit.moveRight")}
              keys="⌥ →"
              shortcut="Alt+ArrowRight"
              icon="next"
              onClick={() => void apply((b) => moveParticipant(b, str(participant.id), 1))}
            />
          </div>
          <AddMessageForm
            title={t("sequenceEdit.addMessageFrom")}
            participants={participants}
            from={str(participant.id)}
            to={str(participants.find((p) => p !== participant)?.id ?? participant.id)}
            onAdd={(spec) => apply((b) => addMessage(b, spec))}
          />
          <AddParticipantForm
            title={t("sequenceEdit.addParticipantAfter")}
            onAdd={(label, category) =>
              apply((b) => addParticipant(b, { label, category, afterId: str(participant.id) }))
            }
          />
          <button
            type="button"
            className="danger"
            onClick={() => {
              const count = participantRemoval(board, str(participant.id)).length;
              if (window.confirm(tn("sequenceEdit.removeParticipantConfirm", count))) {
                void apply((b) => removeParticipant(b, str(participant.id)));
              }
            }}
          >
            {t("sequenceEdit.removeParticipant")}
          </button>
        </section>
      ) : null}

      {pair ? (
        <section className="edit-section">
          <AddMessageForm
            title={t("sequenceEdit.addMessage")}
            participants={participants}
            from={str(pair[0]?.id)}
            to={str(pair[1]?.id)}
            onAdd={(spec) => apply((b) => addMessage(b, spec))}
          />
        </section>
      ) : null}

      {message ? (
        <section className="edit-section" aria-label={t("sequenceEdit.message")}>
          <p className="edit-meta">
            <code>{str(message.id)}</code>{" "}
            <span className="badge">
              {t(`message.${(str(message.messageType) || "sync") as "sync"}`)}
            </span>
            {message.manual ? <span className="badge">{t("sources.manual")}</span> : null}
          </p>
          <Field
            label={t("editPanel.field.label")}
            value={str(message.label)}
            onCommit={(value) =>
              void apply((b) => setMessage(b, str(message.id), { label: value }))
            }
          />
          <Choice
            label={t("sequenceEdit.type")}
            value={str(message.messageType) || "sync"}
            options={messageTypes()}
            onChange={(value) =>
              void apply((b) => setMessage(b, str(message.id), { messageType: value }))
            }
          />
          <Choice
            label={t("sequenceEdit.from")}
            value={str(message.from)}
            options={participants.map((p) => ({ value: str(p.id), label: str(p.label) }))}
            onChange={(value) => void apply((b) => setMessage(b, str(message.id), { from: value }))}
          />
          <Choice
            label={t("sequenceEdit.to")}
            value={str(message.to)}
            options={participants.map((p) => ({ value: str(p.id), label: str(p.label) }))}
            onChange={(value) => void apply((b) => setMessage(b, str(message.id), { to: value }))}
          />
          <div className="edit-actions">
            <MoveButton
              label={t("sequenceEdit.moveUp")}
              keys="⌥ ↑"
              shortcut="Alt+ArrowUp"
              icon="chevronUp"
              disabled={messageMove(board, str(message.id), -1) === null}
              onClick={() => void apply((b) => moveMessage(b, str(message.id), -1))}
            />
            <MoveButton
              label={t("sequenceEdit.moveDown")}
              keys="⌥ ↓"
              shortcut="Alt+ArrowDown"
              icon="chevronDown"
              disabled={messageMove(board, str(message.id), 1) === null}
              onClick={() => void apply((b) => moveMessage(b, str(message.id), 1))}
            />
          </div>
          {(["up", "down"] as const).map((dir) => {
            const note = moveNote(
              board,
              messageMove(board, str(message.id), dir === "up" ? -1 : 1),
              dir,
            );
            return note ? (
              <p key={dir} className="muted edit-note">
                {note}
              </p>
            ) : null;
          })}
          {around.length > 0 ? (
            <fieldset className="edit-actions edit-fieldset">
              <legend className="visually-hidden">{t("sequenceEdit.around")}</legend>
              {around.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="secondary"
                  onClick={() => setPickedOperand({ key: selectionKey, id })}
                >
                  {t("sequenceEdit.editFragment", { fragment: fragmentName(board, id) })}
                </button>
              ))}
            </fieldset>
          ) : null}
          <AddMessageForm
            title={t("sequenceEdit.addMessageAfter")}
            participants={participants}
            from={str(message.from)}
            to={str(message.to)}
            onAdd={(spec) => apply((b) => addMessage(b, { ...spec, afterId: str(message.id) }))}
          />
          <WrapForm
            onWrap={(kind, guard) =>
              void apply((b) => wrapMessages(b, [str(message.id)], kind, guard))
            }
          />
          {message.operandId ? (
            <button
              type="button"
              className="secondary"
              onClick={() => void apply((b) => splitOperand(b, str(message.id)))}
            >
              {t("sequenceEdit.split")}
            </button>
          ) : null}
          <button
            type="button"
            className="danger"
            onClick={() => void apply((b) => removeMessage(b, str(message.id)))}
          >
            {t("sequenceEdit.removeMessage")}
          </button>
        </section>
      ) : null}

      {pickedMessages.length > 1 && selection.nodes.length === 0 ? (
        <section className="edit-section">
          <p className="edit-meta">{tn("sequenceEdit.selectedMessages", pickedMessages.length)}</p>
          <WrapForm
            onWrap={(kind, guard) =>
              void apply((b) =>
                wrapMessages(
                  b,
                  pickedMessages.map((m) => str(m.id)),
                  kind,
                  guard,
                ),
              )
            }
          />
        </section>
      ) : null}

      {fragment && operand && (!message || fromPanel) ? (
        <section className="edit-section" aria-label={t("sequenceEdit.fragment")}>
          <p className="edit-meta">
            <code>{str(operand.id)}</code>{" "}
            <span className="badge">{t(`fragment.${str(fragment.kind) as "alt"}`)}</span>
            {operand.manual || fragment.manual ? (
              <span className="badge">{t("sources.manual")}</span>
            ) : null}
          </p>
          <Field
            label={t("sequenceEdit.guard")}
            value={str(operand.guard)}
            onCommit={(value) => void apply((b) => setOperandGuard(b, str(operand.id), value))}
          />
          <Choice
            label={t("sequenceEdit.changeKind")}
            value={str(fragment.kind)}
            options={fragmentKinds()}
            onChange={(value) =>
              void apply((b) => setFragmentKind(b, str(fragment.id), value as FragmentKind))
            }
          />
          <SplitAt board={board} operandId={str(operand.id)} apply={apply} />
          <button
            type="button"
            className="secondary"
            onClick={() => void apply((b) => unwrapFragment(b, str(fragment.id)))}
          >
            {t("sequenceEdit.unwrap")}
          </button>
        </section>
      ) : null}

      {!participant && !pair && !message && pickedMessages.length < 2 && !operand ? (
        <section className="edit-section">
          <AddParticipantForm
            title={t("sequenceEdit.addParticipant")}
            onAdd={(label, category) => apply((b) => addParticipant(b, { label, category }))}
          />
        </section>
      ) : null}
    </div>
  );
}

/** Splits an operand at one of its messages, picked from a list. */
function SplitAt({
  board,
  operandId,
  apply,
}: {
  board: RawBoard;
  operandId: string;
  apply: Props["apply"];
}) {
  const own = list(board, "edges")
    .filter((e) => e.operandId === operandId)
    .slice(1);
  const [at, setAt] = useState("");
  if (own.length === 0) return null;
  const chosen = at || str(own[0]?.id);
  return (
    <div className="edit-actions">
      <Choice
        label={t("sequenceEdit.splitAt")}
        value={chosen}
        options={own.map((e) => ({ value: str(e.id), label: str(e.label) || str(e.id) }))}
        onChange={setAt}
      />
      <button
        type="button"
        className="secondary"
        onClick={() => void apply((b) => splitOperand(b, chosen))}
      >
        {t("sequenceEdit.split")}
      </button>
    </div>
  );
}
