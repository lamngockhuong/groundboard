import {
  DEFAULT_READING_FONT,
  isReadingFontId,
  type ReadingFontId,
  readFontPreference,
  saveFontPreference,
} from "./fonts.ts";
import { isLayerId, type LayerId } from "./layers.ts";
import {
  DESIGN_SHOWN_KEY,
  HIDDEN_LAYERS_KEY,
  readFlag,
  readList,
  SOURCES_OPEN_KEY,
  saveFlag,
  saveValue,
} from "./prefs.ts";

/**
 * How a board is shown, chosen on its toolbar: the design images, the layers hidden, the
 * reading font, and the source panel. Each tab keeps its own; the last choice made in any tab
 * is stored in `localStorage` and is what a new tab starts with.
 */
export interface ViewPrefs {
  designShown: boolean;
  hiddenLayers: readonly LayerId[];
  font: ReadingFontId;
  sourcesOpen: boolean;
}

/** One choice made on the toolbar. A layer is shown or hidden on its own. */
export type PrefChange =
  | { designShown: boolean }
  | { font: ReadingFontId }
  | { sourcesOpen: boolean }
  | { layer: LayerId; hidden: boolean };

export const DEFAULT_PREFS: ViewPrefs = {
  designShown: true,
  hiddenLayers: [],
  font: DEFAULT_READING_FONT,
  sourcesOpen: true,
};

/** The choices made last, as stored; the defaults where nothing is stored or storage is blocked. */
export function readStoredPrefs(): ViewPrefs {
  return {
    designShown: readFlag(DESIGN_SHOWN_KEY, DEFAULT_PREFS.designShown),
    hiddenLayers: uniqueLayers(readList(HIDDEN_LAYERS_KEY)),
    font: readFontPreference(),
    sourcesOpen: readFlag(SOURCES_OPEN_KEY, DEFAULT_PREFS.sourcesOpen),
  };
}

/** Stores one choice as the last made; the other stored choices stay as they are. */
export function storeChange(change: PrefChange): void {
  if ("designShown" in change) saveFlag(DESIGN_SHOWN_KEY, change.designShown);
  else if ("sourcesOpen" in change) saveFlag(SOURCES_OPEN_KEY, change.sourcesOpen);
  else if ("font" in change) saveFontPreference(change.font);
  else saveValue(HIDDEN_LAYERS_KEY, applyChange(readStoredPrefs(), change).hiddenLayers);
}

/** The choices with one changed. */
export function applyChange(prefs: ViewPrefs, change: PrefChange): ViewPrefs {
  if (!("layer" in change)) return { ...prefs, ...change };
  const others = prefs.hiddenLayers.filter((id) => id !== change.layer);
  return { ...prefs, hiddenLayers: change.hidden ? [...others, change.layer] : others };
}

/** Keeps only the hidden layers the board has; the same object when nothing is dropped. */
export function keepLayers(prefs: ViewPrefs, present: readonly LayerId[]): ViewPrefs {
  const kept = prefs.hiddenLayers.filter((id) => present.includes(id));
  return kept.length === prefs.hiddenLayers.length ? prefs : { ...prefs, hiddenLayers: kept };
}

function uniqueLayers(values: readonly unknown[]): LayerId[] {
  const layers: LayerId[] = [];
  for (const value of values) {
    if (typeof value === "string" && isLayerId(value) && !layers.includes(value)) {
      layers.push(value);
    }
  }
  return layers;
}

/** Choices read back from storage; null when they are not what `ViewPrefs` holds. */
export function readPrefs(value: unknown): ViewPrefs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { designShown, hiddenLayers, font, sourcesOpen } = value as Record<string, unknown>;
  if (typeof designShown !== "boolean" || typeof sourcesOpen !== "boolean") return null;
  if (!isReadingFontId(font) || !Array.isArray(hiddenLayers)) return null;
  if (hiddenLayers.length > 16) return null;
  if (!hiddenLayers.every((id) => typeof id === "string" && isLayerId(id))) return null;
  return { designShown, hiddenLayers: uniqueLayers(hiddenLayers), font, sourcesOpen };
}
