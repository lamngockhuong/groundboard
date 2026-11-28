import { NODE_STYLES } from "@groundboard/render-excalidraw/styles";
import {
  EDGE_KINDS,
  ELEMENT_ROLES,
  HTTP_METHODS,
  LAYOUT_ORIGINS,
  type NodeKind,
  PARTICIPANT_CATEGORIES,
  PLATFORMS,
  TRIGGER_TYPES,
} from "@groundboard/schema";
import {
  type CSSProperties,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  addEdge,
  addNode,
  columnsText,
  type EditResult,
  guardsText,
  NODE_TEXT_FIELDS,
  type NodeTextField,
  type RawBoard,
  removalOf,
  removeEdge,
  removeNode,
  setEdgeLabel,
  setEndpointGuards,
  setNodeText,
  setTableColumns,
} from "../board-edit.ts";
import { t } from "../i18n.ts";
import { type KindGroup, kindGroupsFor, suggestedRef } from "../node-kinds.ts";
import { Icon } from "./Icon.tsx";
import { SequenceEditPanel } from "./SequenceEditPanel.tsx";

type Item = Record<string, unknown>;

interface EditPanelProps {
  board: RawBoard;
  /** Board ids selected on the canvas; the operands of a sequence board's fragments too. */
  selection: { nodes: string[]; edges: string[]; operands?: string[] };
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Applies an edit to the working board; resolves to an error message, or null. */
  onApply: (edit: (board: RawBoard) => EditResult) => Promise<string | null>;
}

export interface EditPanelHandle {
  /** Puts the cursor in the label of the selected node: what a double click on it does. */
  focusLabel: () => void;
  /** Removes the one selected node or arrow, after asking: what Delete does on the canvas. */
  removeSelected: () => void;
}

const nodesOf = (board: RawBoard) => (Array.isArray(board.nodes) ? (board.nodes as Item[]) : []);
const edgesOf = (board: RawBoard) => (Array.isArray(board.edges) ? (board.edges as Item[]) : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Which text fields a node of this kind has. */
function fieldsOf(node: Item): NodeTextField[] {
  return NODE_TEXT_FIELDS.filter(
    (field) =>
      field === "label" ||
      field === "detail" ||
      (node.kind === "element" && (field === "action" || field === "unresolved")),
  );
}

/** A text field that applies its edit when it loses focus, not on every key. */
function CommitField({
  label,
  value,
  multiline,
  onCommit,
  inputRef,
}: {
  label: string;
  value: string;
  multiline: boolean;
  onCommit: (value: string) => void;
  inputRef?: React.Ref<HTMLTextAreaElement & HTMLInputElement>;
}) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="edit-field" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          ref={inputRef}
          value={draft}
          rows={3}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={id}
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      )}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className="edit-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** How the swatch of a kind is drawn, after the shape the board gives that kind. */
const SWATCH_SHAPES: Partial<Record<NodeKind, string>> = {
  state: "ellipse",
  decision: "diamond",
  note: "text",
  screen: "frame",
  resource: "frame",
  table: "frame",
  job: "frame",
};

/** A small sample of a node of this kind, in the colours and stroke the board draws it with. */
function KindSwatch({ kind }: { kind: NodeKind }) {
  const style = NODE_STYLES[kind];
  const shape = SWATCH_SHAPES[kind] ?? "box";
  return (
    <span
      className={`kind-swatch kind-swatch--${shape}`}
      aria-hidden="true"
      style={
        {
          "--swatch-stroke": style.strokeColor,
          "--swatch-fill": style.backgroundColor,
          "--swatch-dash": style.strokeStyle,
          "--swatch-width": `${style.strokeWidth}px`,
          color: style.textColor,
        } as CSSProperties
      }
    >
      {shape === "text" ? "Aa" : null}
    </span>
  );
}

/** Picks the kind of a new node from a list that shows what each kind is and how it looks. */
function KindPicker({
  groups,
  value,
  onChange,
}: {
  groups: KindGroup[];
  value: string;
  onChange: (kind: NodeKind) => void;
}) {
  const name = useId();
  return (
    <fieldset className="kind-picker">
      <legend>{t("editPanel.kind")}</legend>
      {groups.map((group) => (
        <fieldset key={group.id} className="kind-group">
          <legend className="kind-group-title">{t(`group.${group.id}`)}</legend>
          {group.kinds.map((kind) => (
            <label key={kind} className="kind-option">
              <input
                type="radio"
                className="visually-hidden"
                name={name}
                value={kind}
                checked={value === kind}
                onChange={() => onChange(kind)}
              />
              <KindSwatch kind={kind} />
              <span className="kind-text">
                <span className="kind-name">{t(`nodeKind.${kind}`)}</span>
                <span className="kind-hint">{t(`nodeKind.${kind}.hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </fieldset>
  );
}

/**
 * The ref of a new node. Left empty, the node takes the ref suggested from its label, which the
 * field shows in place of an example.
 */
function RefField({
  value,
  suggested,
  example,
  onChange,
}: {
  value: string;
  suggested: string | null;
  example: string;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  return (
    <label className="edit-field">
      <span>{t("editPanel.ref")}</span>
      <input
        value={value}
        placeholder={suggested ?? example}
        aria-describedby={suggested ? hintId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {suggested ? (
        <small id={hintId} className="edit-field-hint">
          {t("editPanel.refSuggested")}
        </small>
      ) : null}
    </label>
  );
}

/**
 * The side panel of edit mode: edit the text of the node or edge selected on the canvas, remove
 * it, connect two selected nodes, and add a node. Every edit goes through `onApply`, which
 * validates it and refuses one that would break the board.
 */
export const EditPanel = forwardRef<EditPanelHandle, EditPanelProps>(function EditPanel(
  { board, selection, canUndo, canRedo, onUndo, onRedo, onApply },
  ref,
) {
  const [error, setError] = useState<string | null>(null);
  const labelRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const apply = async (edit: (b: RawBoard) => EditResult): Promise<string | null> => {
    const failed = await onApply(edit);
    setError(failed);
    return failed;
  };

  // A sequence board edits its participants, messages and fragments in a panel of its own; a
  // question or a note on it is edited here as anywhere.
  const sequence = nodesOf(board).some((n) => n.kind === "participant");
  const selectedNode =
    selection.nodes.length === 1 && selection.edges.length === 0
      ? nodesOf(board).find((n) => n.id === selection.nodes[0])
      : undefined;
  const node = sequence && selectedNode?.kind === "participant" ? undefined : selectedNode;
  const edge =
    !sequence && selection.edges.length === 1 && selection.nodes.length === 0
      ? edgesOf(board).find((e) => e.id === selection.edges[0])
      : undefined;
  const pair =
    !sequence && selection.nodes.length === 2 && selection.edges.length === 0
      ? selection.nodes
      : null;
  const [category, setCategory] = useState<string>("system");

  /** The pair whose direction was swapped; another pair starts unswapped. */
  const [swappedPair, setSwappedPair] = useState<string | null>(null);
  const pairKey = pair ? pair.join(" ") : null;
  const swap = pairKey !== null && swappedPair === pairKey;
  const [edgeKind, setEdgeKind] = useState<string>("flow");
  const [edgeLabel, setEdgeLabelDraft] = useState("");

  const kindGroups = kindGroupsFor(nodesOf(board));
  // A new node starts as the first kind of the group that fits the board.
  const [kind, setKind] = useState<string>(() => kindGroups[0]?.kinds[0] ?? "step");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<string>("button");
  const [ref_, setRef] = useState("");
  const [platform, setPlatform] = useState<string>("web");
  const autoRef = suggestedRef(kind, label, platform);
  const refOrSuggested = ref_.trim() || autoRef || "";
  const [layoutFrom, setLayoutFrom] = useState<string>("doc");
  const [method, setMethod] = useState<string>("GET");
  const [path, setPath] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [triggerType, setTriggerType] = useState<string>("queue");
  const [triggerValue, setTriggerValue] = useState("");
  const triggerField = { cron: "schedule", queue: "queue", event: "event" }[triggerType];
  const resources = nodesOf(board).filter((n) => n.kind === "resource");
  const [resourceId, setResourceId] = useState("");
  const resource = node?.kind === "resource" ? str(node.id) : resourceId;
  const screens = nodesOf(board).filter((n) => n.kind === "screen" || n.kind === "element");
  const [parentId, setParentId] = useState("");
  const parent =
    node && (node.kind === "screen" || node.kind === "element") ? str(node.id) : parentId;

  const remove = (what: "node" | "edge", id: string) => {
    if (what === "edge") {
      if (window.confirm(t("editPanel.removeEdgeConfirm"))) void apply((b) => removeEdge(b, id));
      return;
    }
    const gone = removalOf(board, id);
    const message = t("editPanel.removeNodeConfirm", {
      nodes: gone.nodes.length,
      edges: gone.edges.length,
      sources: gone.sources.length,
    });
    if (window.confirm(message)) void apply((b) => removeNode(b, id));
  };

  // No dependency list: the selection read here is the one shown now.
  useImperativeHandle(ref, () => ({
    focusLabel: () => labelRef.current?.focus(),
    removeSelected: () => {
      if (node) remove("node", str(node.id));
      else if (edge) remove("edge", str(edge.id));
    },
  }));

  return (
    <aside className="edit-panel" aria-label={t("editPanel.title")}>
      <div className="edit-panel-head">
        <h3>{t("editPanel.title")}</h3>
        <div className="edit-panel-history">
          <button
            type="button"
            className="ghost icon-button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label={t("editPanel.undo")}
            title={t("editPanel.undo")}
          >
            <Icon name="back" size={16} />
          </button>
          <button
            type="button"
            className="ghost icon-button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label={t("editPanel.redo")}
            title={t("editPanel.redo")}
          >
            <Icon name="next" size={16} />
          </button>
        </div>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {node ? (
        <section className="edit-section">
          <p className="edit-meta">
            <code>{str(node.id)}</code> <span className="badge">{str(node.kind)}</span>
            {node.manual ? <span className="badge">{t("sources.manual")}</span> : null}
          </p>
          {fieldsOf(node).map((field) => (
            <CommitField
              key={`${str(node.id)}:${field}`}
              label={t(`editPanel.field.${field}`)}
              value={str(node[field])}
              multiline={field === "label" || field === "detail"}
              onCommit={(value) => void apply((b) => setNodeText(b, str(node.id), field, value))}
              {...(field === "label" ? { inputRef: labelRef } : {})}
            />
          ))}
          {node.kind === "table" ? (
            <CommitField
              key={`${str(node.id)}:columns`}
              label={t("editPanel.columns")}
              value={columnsText(node.columns)}
              multiline
              onCommit={(value) => void apply((b) => setTableColumns(b, str(node.id), value))}
            />
          ) : null}
          {node.kind === "endpoint" ? (
            <CommitField
              key={`${str(node.id)}:guards`}
              label={t("editPanel.guards")}
              value={guardsText(node.guards)}
              multiline
              onCommit={(value) => void apply((b) => setEndpointGuards(b, str(node.id), value))}
            />
          ) : null}
          {node.kind === "endpoint" && !Array.isArray(node.guards) ? (
            // An unread handler shows an empty field, which clearing cannot change.
            <button
              type="button"
              className="secondary"
              onClick={() => void apply((b) => setEndpointGuards(b, str(node.id), ""))}
            >
              {t("editPanel.noGuard")}
            </button>
          ) : null}
          <p className="muted edit-note">{t("editPanel.manualNote")}</p>
          <button type="button" className="danger" onClick={() => remove("node", str(node.id))}>
            {t("editPanel.removeNode")}
          </button>
        </section>
      ) : null}

      {edge ? (
        <section className="edit-section">
          <p className="edit-meta">
            <code>{str(edge.id)}</code> <span className="badge">{str(edge.kind)}</span>
          </p>
          <CommitField
            key={str(edge.id)}
            label={t("editPanel.field.label")}
            value={str(edge.label)}
            multiline={false}
            onCommit={(value) => void apply((b) => setEdgeLabel(b, str(edge.id), value))}
          />
          <button type="button" className="danger" onClick={() => remove("edge", str(edge.id))}>
            {t("editPanel.removeEdge")}
          </button>
        </section>
      ) : null}

      {pair ? (
        <section className="edit-section">
          <h4>{t("editPanel.connect")}</h4>
          <p className="edit-meta">
            <code>{swap ? pair[1] : pair[0]}</code> → <code>{swap ? pair[0] : pair[1]}</code>{" "}
            <button
              type="button"
              className="ghost"
              onClick={() => setSwappedPair(swap ? null : pairKey)}
            >
              {t("editPanel.swap")}
            </button>
          </p>
          <Select
            label={t("editPanel.kind")}
            value={edgeKind}
            options={EDGE_KINDS}
            onChange={setEdgeKind}
          />
          <label className="edit-field">
            <span>{t("editPanel.field.label")}</span>
            <input
              value={edgeLabel}
              onChange={(event) => setEdgeLabelDraft(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const [from, to] = swap ? [pair[1], pair[0]] : [pair[0], pair[1]];
              void apply((b) =>
                addEdge(b, {
                  from: from as string,
                  to: to as string,
                  kind: edgeKind,
                  label: edgeLabel,
                }),
              ).then((failed) => {
                if (failed === null) setEdgeLabelDraft("");
              });
            }}
          >
            {t("editPanel.connectButton")}
          </button>
        </section>
      ) : null}

      {sequence ? (
        <SequenceEditPanel
          board={board}
          selection={{ ...selection, operands: selection.operands ?? [] }}
          apply={apply}
        />
      ) : null}

      {!sequence && !node && !edge && !pair ? (
        <p className="muted">{t("editPanel.selectHint")}</p>
      ) : null}

      <details className="edit-section">
        <summary>{t("editPanel.addNode")}</summary>
        <KindPicker groups={kindGroups} value={kind} onChange={setKind} />
        <label className="edit-field">
          <span>{t("editPanel.field.label")}</span>
          <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
        </label>
        {kind === "element" ? (
          <>
            {node && (node.kind === "screen" || node.kind === "element") ? (
              <p className="edit-meta">
                {t("editPanel.parent")} <code>{parent}</code>
              </p>
            ) : (
              <Select
                label={t("editPanel.parent")}
                value={parentId}
                options={["", ...screens.map((s) => str(s.id))]}
                onChange={setParentId}
              />
            )}
            <Select
              label={t("editPanel.role")}
              value={role}
              options={ELEMENT_ROLES}
              onChange={setRole}
            />
          </>
        ) : null}
        {kind === "endpoint" ? (
          <>
            {node?.kind === "resource" ? (
              <p className="edit-meta">
                {t("editPanel.parent")} <code>{resource}</code>
              </p>
            ) : (
              <Select
                label={t("editPanel.parent")}
                value={resourceId}
                options={["", ...resources.map((r) => str(r.id))]}
                onChange={setResourceId}
              />
            )}
            <Select
              label={t("editPanel.method")}
              value={method}
              options={HTTP_METHODS}
              onChange={setMethod}
            />
            <label className="edit-field">
              <span>{t("editPanel.path")}</span>
              <input
                value={path}
                placeholder="/orders/:id"
                onChange={(event) => setPath(event.currentTarget.value)}
              />
            </label>
            <label className="edit-field">
              <span>{t("editPanel.ref")}</span>
              <input
                value={ref_}
                placeholder="api:orders/get-id"
                onChange={(event) => setRef(event.currentTarget.value)}
              />
            </label>
          </>
        ) : null}
        {kind === "job" ? (
          <>
            <RefField
              value={ref_}
              suggested={autoRef}
              example="batch:send-receipt"
              onChange={setRef}
            />
            <Select
              label={t("editPanel.trigger")}
              value={triggerType}
              options={TRIGGER_TYPES}
              onChange={setTriggerType}
            />
            {triggerField ? (
              <label className="edit-field">
                <span>
                  {t(`editPanel.trigger.${triggerField as "schedule" | "queue" | "event"}`)}
                </span>
                <input
                  value={triggerValue}
                  placeholder={triggerType === "cron" ? "0 2 * * *" : ""}
                  onChange={(event) => setTriggerValue(event.currentTarget.value)}
                />
              </label>
            ) : null}
          </>
        ) : null}
        {kind === "table" ? (
          <RefField value={ref_} suggested={autoRef} example="db:orders" onChange={setRef} />
        ) : null}
        {kind === "participant" ? (
          <Select
            label={t("sequenceEdit.category")}
            value={category}
            options={PARTICIPANT_CATEGORIES}
            onChange={setCategory}
          />
        ) : null}
        {kind === "resource" ? (
          <>
            <RefField value={ref_} suggested={autoRef} example="api:orders" onChange={setRef} />
            <label className="edit-field">
              <span>{t("editPanel.pathPrefix")}</span>
              <input
                value={pathPrefix}
                placeholder="/v1"
                onChange={(event) => setPathPrefix(event.currentTarget.value)}
              />
            </label>
          </>
        ) : null}
        {kind === "screen" ? (
          <>
            <RefField
              value={ref_}
              suggested={autoRef}
              example={`${platform}:screen-name`}
              onChange={setRef}
            />
            <Select
              label={t("editPanel.platform")}
              value={platform}
              options={PLATFORMS}
              onChange={setPlatform}
            />
            <Select
              label={t("editPanel.layoutFrom")}
              value={layoutFrom}
              options={LAYOUT_ORIGINS}
              onChange={setLayoutFrom}
            />
          </>
        ) : null}
        <button
          type="button"
          disabled={label.trim() === ""}
          onClick={() =>
            void apply((b) =>
              addNode(b, {
                kind,
                label,
                ...(kind === "element" ? { parentId: parent, role } : {}),
                ...(kind === "screen" ? { ref: refOrSuggested, platform, layoutFrom } : {}),
                ...(kind === "endpoint" ? { parentId: resource, method, path, ref: ref_ } : {}),
                ...(kind === "resource" ? { ref: refOrSuggested, pathPrefix } : {}),
                ...(kind === "table" ? { ref: refOrSuggested } : {}),
                ...(kind === "participant" ? { category } : {}),
                ...(kind === "job"
                  ? {
                      ref: refOrSuggested,
                      trigger: {
                        type: triggerType,
                        ...(triggerField ? { [triggerField]: triggerValue } : {}),
                      },
                    }
                  : {}),
              }),
            ).then((failed) => {
              if (failed !== null) return;
              setLabel("");
              setRef("");
            })
          }
        >
          {t("editPanel.addButton")}
        </button>
      </details>
    </aside>
  );
});
