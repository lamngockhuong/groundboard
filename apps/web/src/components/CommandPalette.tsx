import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import type { AtlasIndex } from "../api.ts";
import { groupSingular, statusLabel } from "../atlas-nav.ts";
import { t, tn } from "../i18n.ts";
import { type PaletteItem, searchPalette } from "../palette.ts";
import type { BoardNode } from "../sources.ts";
import { Icon } from "./Icon.tsx";
import { Modal } from "./Modal.tsx";

interface CommandPaletteProps {
  atlas: AtlasIndex | null;
  nodes: readonly BoardNode[];
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}

function ItemText({ item }: { item: PaletteItem }) {
  switch (item.type) {
    case "board":
      return (
        <>
          <span className="palette-main">{item.board.title}</span>
          <span className="palette-meta">
            {groupSingular(item.board.kind)} · {item.board.slug}
            {item.board.status !== "ok" ? ` · ${statusLabel(item.board.status)}` : ""}
          </span>
        </>
      );
    case "node":
      return (
        <>
          <span className="palette-main">
            <code>{item.node.nodeId}</code>
            {item.node.label ? ` ${item.node.label}` : ""}
          </span>
          <span className="palette-meta">
            {item.node.kind}
            {item.node.location ? ` · ${item.node.location}` : ""}
          </span>
        </>
      );
    case "ref":
      return (
        <>
          <span className="palette-main">
            <code>{item.ref.ref}</code>
          </span>
          <span className="palette-meta">
            {tn("palette.definedOn", item.ref.definedIn.length)},{" "}
            {tn("palette.usedOn", item.ref.usedIn.length)}
          </span>
        </>
      );
  }
}

const itemKey = (item: PaletteItem) =>
  item.type === "board"
    ? `board:${item.board.slug}`
    : item.type === "node"
      ? `node:${item.node.nodeId}`
      : `ref:${item.ref.ref}`;

/**
 * Jump to a board, a node of the board on screen, or a ref. A modal dialog whose input is a
 * combobox over one listbox of results; arrows move, Enter opens, Esc closes.
 */
export function CommandPalette({ atlas, nodes, onPick, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const baseId = useId();
  const groups = useMemo(() => searchPalette(query, { atlas, nodes }), [query, atlas, nodes]);
  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    onPick(item);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      event.preventDefault();
      if (flat.length > 0) setActive((to + flat.length) % flat.length);
    };
    switch (event.key) {
      case "ArrowDown":
        return move(current + 1);
      case "ArrowUp":
        return move(current - 1);
      case "Home":
        if (event.ctrlKey) move(0);
        return;
      case "End":
        if (event.ctrlKey) move(flat.length - 1);
        return;
      case "Enter":
        event.preventDefault();
        return choose(flat[current]);
    }
  };

  let index = -1;
  return (
    <Modal className="palette" label={t("common.searchAll")} onClose={onClose}>
      <div className="palette-box">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={`${baseId}-list`}
            aria-activedescendant={flat.length > 0 ? optionId(current) : undefined}
            aria-autocomplete="list"
            aria-label={t("common.searchAll")}
            placeholder={atlas ? t("palette.placeholder") : t("palette.placeholderNodes")}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="kbd" aria-hidden="true">
            Esc
          </span>
        </div>
        <div
          id={`${baseId}-list`}
          role="listbox"
          className="palette-list"
          aria-label={t("palette.results")}
        >
          {groups.map((group, groupIndex) => (
            // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group"; a fieldset is not allowed there.
            <div key={group.title} role="group" aria-labelledby={`${baseId}-group-${groupIndex}`}>
              <div
                id={`${baseId}-group-${groupIndex}`}
                className="palette-group"
                role="presentation"
              >
                {group.title}
              </div>
              {group.items.map((item) => {
                index += 1;
                const at = index;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: focus stays in the combobox, which points at the option with aria-activedescendant and takes its keys.
                  <div
                    key={itemKey(item)}
                    id={optionId(at)}
                    role="option"
                    aria-selected={at === current}
                    className={at === current ? "palette-option active" : "palette-option"}
                    onMouseMove={() => setActive(at)}
                    onClick={() => choose(item)}
                  >
                    <ItemText item={item} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Outside the listbox, which may hold only options; announced when it appears. */}
        <p className="palette-empty" role="status">
          {flat.length > 0 ? "" : query.trim() === "" ? t("palette.nothing") : t("palette.noMatch")}
        </p>
      </div>
    </Modal>
  );
}
