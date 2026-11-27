/**
 * On/off choices of the viewer kept across reloads, such as a collapsed sidebar. Storage can be
 * blocked (privacy mode, sandboxed frames); the choice then lasts for this page load.
 */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === "1" ? true : stored === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
}

/** A stored number within [min, max]; the fallback when it is missing, malformed or blocked. */
export function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(localStorage.getItem(key) ?? Number.NaN);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  } catch {
    return fallback;
  }
}

/** A stored list of strings; empty when it is missing, malformed or blocked. */
export function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveValue(key: string, value: number | readonly string[]): void {
  try {
    localStorage.setItem(key, typeof value === "number" ? String(value) : JSON.stringify(value));
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
}

export const SIDEBAR_COLLAPSED_KEY = "groundboard.sidebarCollapsed";
export const SOURCES_OPEN_KEY = "groundboard.sourcesOpen";
export const DESIGN_SHOWN_KEY = "groundboard.designShown";
export const SIDEBAR_WIDTH_KEY = "groundboard.sidebarWidth";
export const SIDEBAR_BY_TAG_KEY = "groundboard.sidebarByTag";
export const SIDEBAR_CLOSED_SECTIONS_KEY = "groundboard.sidebarClosedSections";
export const HIDDEN_LAYERS_KEY = "groundboard.hiddenLayers";
export const MOTION_ALL_KEY = "groundboard.motionAll";
export const PRESENT_DELAY_KEY = "groundboard.presentDelay";
export const SPLIT_RATIO_KEY = "groundboard.splitRatio";
