import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as z from "zod";
import "@fontsource-variable/figtree/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { App } from "./App.tsx";
import { installFontSourceFilter } from "./font-sources.ts";
import { applyLocale } from "./i18n.ts";
import "./styles.css";
import {
  applyStyle,
  applyTheme,
  readStylePreference,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
} from "./theme.ts";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Excalidraw reads this when it loads fonts. Pointing it at the page's own base URL serves
// the fonts copied into the build, instead of the esm.sh CDN default. It must be set before
// the editor chunk is imported, which happens lazily from App.
window.EXCALIDRAW_ASSET_PATH = new URL("./", window.location.href).href;
// Excalidraw still lists its esm.sh copy after the local one; drop it so the CSP has nothing
// to block. Also installed before the editor chunk creates its font faces.
installFontSourceFilter();

// Zod probes for code generation with `new Function`, which `script-src 'self'` blocks and
// reports as a violation. The viewer only validates small boards, so skip the probe.
z.config({ jitless: true });

// Set the theme and style before the first render so the page does not flash light first.
applyTheme(resolveTheme(readThemePreference(), systemPrefersDark()));
applyStyle(readStylePreference());
// And the language, so <html lang> names the language of the first paint.
applyLocale();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
