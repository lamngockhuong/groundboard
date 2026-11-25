import { t } from "./i18n.ts";
import { safeExternalUrl } from "./links.ts";

/** A scene in the shape Excalidraw's `initialData` accepts. Elements stay opaque here. */
export interface Scene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export type ParsedInput =
  | { kind: "scene"; scene: Scene }
  | { kind: "board"; board: Record<string, unknown> }
  | { kind: "error"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Drops element links that are not https before the scene reaches the editor, so no other
 * scheme can be opened from it, whichever way the user follows the link.
 */
function withSafeLinks(elements: readonly unknown[]): unknown[] {
  return elements.map((el) =>
    isRecord(el) && typeof el.link === "string" && safeExternalUrl(el.link) === null
      ? { ...el, link: null }
      : el,
  );
}

/** Validates the parts of an `.excalidraw` document the viewer relies on. */
export function toScene(value: unknown): Scene | null {
  if (!isRecord(value) || !Array.isArray(value.elements)) return null;
  return {
    elements: withSafeLinks(value.elements),
    appState: isRecord(value.appState) ? value.appState : {},
    files: isRecord(value.files) ? value.files : {},
  };
}

/**
 * Classifies pasted or dropped text by its JSON `type` field: `"excalidraw"` is a scene to
 * load directly; any other JSON object is treated as a board IR for the server to render.
 */
export function parseInput(text: string): ParsedInput {
  if (text.trim() === "") return { kind: "error", message: t("input.empty") };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: t("input.notJson", { detail }) };
  }
  if (!isRecord(value)) {
    return { kind: "error", message: t("input.notObject") };
  }
  if (value.type === "excalidraw") {
    const scene = toScene(value);
    return scene ? { kind: "scene", scene } : { kind: "error", message: t("input.noElements") };
  }
  return { kind: "board", board: value };
}
