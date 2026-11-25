/** Colour theme of the viewer: follow the system, or a fixed light or dark choice. */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const THEME_KEY = "groundboard.theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];

const isPreference = (value: unknown): value is ThemePreference =>
  ORDER.includes(value as ThemePreference);

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export const systemPrefersDark = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Sets the theme on <html>, where the CSS tokens read it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/**
 * Visual style of the viewer's chrome, independent of light or dark: colours, type, radii and
 * how buttons answer hover and press. The board itself keeps the colours the renderer drew.
 */
export type ThemeStyle = "classic" | "precision" | "blueprint" | "editorial" | "signal";

interface StyleSwatch {
  surface: string;
  ink: string;
  accent: string;
}

export interface ThemeStyleInfo {
  /** Named by `style.<id>` and described by `style.<id>.hint` in the messages. */
  id: ThemeStyle;
  /** Colours shown beside the style's name in the picker, for each theme. */
  swatches: Record<Theme, StyleSwatch>;
}

export const THEME_STYLES: readonly ThemeStyleInfo[] = [
  {
    id: "classic",
    swatches: {
      light: { surface: "#f8fafc", ink: "#0f172a", accent: "#4f46e5" },
      dark: { surface: "#0b1120", ink: "#e2e8f0", accent: "#818cf8" },
    },
  },
  {
    id: "precision",
    swatches: {
      light: { surface: "#fafafa", ink: "#18181b", accent: "#2563eb" },
      dark: { surface: "#09090b", ink: "#fafafa", accent: "#60a5fa" },
    },
  },
  {
    id: "blueprint",
    swatches: {
      light: { surface: "#f5f4ee", ink: "#0f1f3a", accent: "#c2410c" },
      dark: { surface: "#0a1424", ink: "#e6edf7", accent: "#fb923c" },
    },
  },
  {
    id: "editorial",
    swatches: {
      light: { surface: "#f7f5f2", ink: "#1c1917", accent: "#0f766e" },
      dark: { surface: "#1a1715", ink: "#f2ede7", accent: "#2dd4bf" },
    },
  },
  {
    id: "signal",
    swatches: {
      light: { surface: "#f6f7f5", ink: "#111311", accent: "#3f6212" },
      dark: { surface: "#0c0d0c", ink: "#ecefe9", accent: "#a3e635" },
    },
  },
];

const STYLE_KEY = "groundboard.style";
export const DEFAULT_STYLE: ThemeStyle = "classic";

export const isThemeStyle = (value: unknown): value is ThemeStyle =>
  THEME_STYLES.some((s) => s.id === value);

/** The style the viewer last picked, or the default when none is stored or storage is blocked. */
export function readStylePreference(): ThemeStyle {
  try {
    const stored = localStorage.getItem(STYLE_KEY);
    return isThemeStyle(stored) ? stored : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveStylePreference(style: ThemeStyle): void {
  try {
    if (style === DEFAULT_STYLE) localStorage.removeItem(STYLE_KEY);
    else localStorage.setItem(STYLE_KEY, style);
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
}

/** Sets the style on <html>, where the CSS tokens read it. */
export function applyStyle(style: ThemeStyle): void {
  document.documentElement.dataset.style = style;
}
