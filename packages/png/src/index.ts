import { Resvg } from "@resvg/resvg-js";
import { installDom } from "./dom.ts";
import { encodeRgbaRegion } from "./encode.ts";
import { DEFAULT_FONT_FAMILY, fontFiles } from "./fonts.ts";
import { planSize, SIZE_DEFAULTS, type SizeOptions, type TileRect } from "./plan.ts";

export { planSize, SIZE_DEFAULTS, type SizeOptions, type SizePlan, type TileRect } from "./plan.ts";

export type Theme = "light" | "dark";

/**
 * The viewer's reading fonts, by the ids its font menu uses, as Excalidraw `fontFamily` ids;
 * `board` keeps the font each text was drawn with. The viewer opens boards in `sans`.
 */
export const READING_FONTS = { board: null, hand: 5, sans: 6, system: 2, mono: 3 } as const;
export type ReadingFont = keyof typeof READING_FONTS;
export const DEFAULT_READING_FONT: ReadingFont = "sans";

/** An Excalidraw scene as groundboard writes it (`.excalidraw`). */
export interface Scene {
  elements: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export interface RenderOptions extends SizeOptions {
  theme: Theme;
  font: ReadingFont;
}

export interface PngTile extends TileRect {
  png: Uint8Array;
}

export interface PngRender {
  scale: number;
  /** The whole board at `scale`; with one tile, that tile's size. */
  width: number;
  height: number;
  rows: number;
  cols: number;
  tiles: PngTile[];
}

interface SceneElement {
  type?: string;
  isDeleted?: boolean;
  fontFamily?: number;
  fontSize?: number;
}

type ExportToSvg = (options: Record<string, unknown>) => Promise<SVGSVGElement>;

/**
 * Draws a scene as PNG with Excalidraw's own `exportToSvg`, the call behind the viewer's
 * export, and rasterises the SVG with resvg. No browser, no network.
 *
 * The board is one image whose long edge is at most `maxEdge`, or several tiles when fitting it
 * there would draw its smallest text below `minText` pixels (see `planSize`).
 */
export async function renderPng(
  scene: Scene,
  options: Partial<RenderOptions> = {},
): Promise<PngRender> {
  const { theme = "light", font = DEFAULT_READING_FONT, ...size } = options;
  const sizing: SizeOptions = { ...SIZE_DEFAULTS, ...size };
  const family = READING_FONTS[font];
  if (family === undefined) throw new Error(`unknown font ${JSON.stringify(font)}`);
  const elements = (scene.elements as SceneElement[])
    .filter((el) => !el.isDeleted)
    .map((el) =>
      el.type === "text" && family !== null && el.fontFamily !== family
        ? { ...el, fontFamily: family }
        : el,
    );

  const w = installDom();
  const { exportToSvg } = (await import("./excalidraw.ts")) as unknown as {
    exportToSvg: ExportToSvg;
  };
  const svg = await exportToSvg({
    elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: theme === "dark",
      theme,
    },
    files: scene.files ?? {},
    skipInliningFonts: true,
  });
  replaceHelvetica(svg);

  const [, , boardWidth = 0, boardHeight = 0] = (svg.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number);
  if (!(boardWidth > 0 && boardHeight > 0)) throw new Error("the scene has nothing to draw");
  const plan = planSize(boardWidth, boardHeight, smallestFontSize(elements), sizing);

  const serializer = new (w as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer();
  // The whole board is drawn once at the planned pixel size; tiles are cut from that raster.
  // (Drawing each tile through a shifted viewBox made resvg panic on the dark theme's filter.)
  svg.setAttribute("width", String(plan.width));
  svg.setAttribute("height", String(plan.height));
  svg.setAttribute("preserveAspectRatio", "none");
  const image = new Resvg(serializer.serializeToString(svg), {
    fitTo: { mode: "original" },
    font: {
      fontFiles: fontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: DEFAULT_FONT_FAMILY,
    },
  }).render();
  const tiles: PngTile[] =
    plan.tiles.length === 1
      ? plan.tiles.map((tile) => ({ ...tile, png: bytes(image.asPng()) }))
      : plan.tiles.map((tile) => ({
          ...tile,
          png: encodeRgbaRegion(bytes(image.pixels), image.width, tile),
        }));
  return {
    scale: plan.scale,
    width: plan.width,
    height: plan.height,
    rows: plan.rows,
    cols: plan.cols,
    tiles,
  };
}

function bytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function smallestFontSize(elements: readonly SceneElement[]): number {
  let smallest = 0;
  for (const el of elements) {
    if (el.type !== "text" || typeof el.fontSize !== "number" || el.fontSize <= 0) continue;
    if (smallest === 0 || el.fontSize < smallest) smallest = el.fontSize;
  }
  return smallest;
}

/**
 * Frame names, and text set in Excalidraw's "system" font, are drawn in "Helvetica", which the
 * rasteriser does not have (it reads no system fonts). Assistant, a sans the viewer ships, takes
 * its place. Liberation Sans, which Excalidraw ships with Helvetica's metrics, is left out for
 * its licence (GPL-2.0 with a font exception), as in the viewer.
 */
function replaceHelvetica(svg: SVGSVGElement): void {
  for (const el of svg.querySelectorAll("[font-family]")) {
    const value = el.getAttribute("font-family") ?? "";
    if (/^\s*Helvetica\b/.test(value)) el.setAttribute("font-family", `Assistant, ${value}`);
  }
}
