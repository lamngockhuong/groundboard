/** How large the image may be and when it is split instead of shrunk. */
export interface SizeOptions {
  /** Longest side of one image, in pixels. */
  maxEdge: number;
  /** Smallest text height, in pixels, still readable; below it the board is tiled instead. */
  minText: number;
  /** Largest scale used, so a small board is not blown up. */
  maxScale: number;
  /** Pixels two neighbouring tiles share, so a line of text cut by one edge is whole in the other. */
  overlap: number;
}

export const SIZE_DEFAULTS: SizeOptions = {
  // The long edge above which Claude's vision input downscales an image.
  maxEdge: 1568,
  minText: 8,
  maxScale: 2,
  overlap: 48,
};

/** One image of the render, in pixels of the scaled board. */
export interface TileRect {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizePlan {
  scale: number;
  /** The whole board at `scale`. */
  width: number;
  height: number;
  rows: number;
  cols: number;
  tiles: TileRect[];
}

/**
 * Picks the scale and the tiles for a board of `width` × `height` (scene units, padding
 * included) whose smallest text is `smallestFont` units tall (0 when it has no text).
 *
 * The board is drawn as one image scaled to fit `maxEdge`, unless that would draw its smallest
 * text below `minText` pixels. Then it is cut into tiles of at most `maxEdge` on each side,
 * drawn at its own size (scale 1) or larger when its text needs it to reach `minText`; never
 * above `maxScale`.
 */
export function planSize(
  width: number,
  height: number,
  smallestFont: number,
  options: SizeOptions,
): SizePlan {
  const { maxEdge, minText, maxScale, overlap } = options;
  const fitScale = Math.min(maxScale, maxEdge / Math.max(width, height));
  const readScale = smallestFont > 0 ? minText / smallestFont : 0;
  const scale = fitScale >= readScale ? fitScale : Math.min(maxScale, Math.max(1, readScale));
  const fullWidth = Math.max(1, Math.round(width * scale));
  const fullHeight = Math.max(1, Math.round(height * scale));
  const xs = spans(fullWidth, maxEdge, overlap);
  const ys = spans(fullHeight, maxEdge, overlap);
  const tiles: TileRect[] = [];
  ys.forEach(([y, h], row) => {
    xs.forEach(([x, w], col) => {
      tiles.push({ row: row + 1, col: col + 1, x, y, width: w, height: h });
    });
  });
  return {
    scale,
    width: fullWidth,
    height: fullHeight,
    rows: ys.length,
    cols: xs.length,
    tiles,
  };
}

/** Cuts `[0, total)` into equal spans of at most `max`, neighbours sharing at least `overlap`. */
function spans(total: number, max: number, overlap: number): [number, number][] {
  if (total <= max) return [[0, total]];
  const share = Math.min(overlap, Math.floor(max / 2));
  const count = Math.ceil((total - share) / (max - share));
  const size = Math.min(max, Math.ceil((total + (count - 1) * share) / count));
  const result: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    result.push([Math.round((i * (total - size)) / (count - 1)), size]);
  }
  return result;
}
