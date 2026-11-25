import { measureText, wrapText } from "./measure.ts";
import type { FrameMarkers } from "./ref-markers.ts";
import { SMALL_FONT_SIZE } from "./text.ts";
import type { LaidOutText } from "./types.ts";
import type { ScreenLayout } from "./wireframe.ts";

/**
 * A reference image beside a frame: the design the frame was drawn from, placed right of the
 * frame and of everything drawn beside it (local routes, the list of targets), top-aligned
 * with the frame, at one image pixel per board pixel. Layout only reserves its room; the
 * renderer draws it. Everything here is relative to the top-left corner of the frame's body.
 */

/** Space between the frame's list of targets (or the frame) and the reference. */
export const REFERENCE_GAP = 120;
/** Space between the image and its dashed border. */
const PAD = 8;
const CAPTION_GAP = 6;
/** Narrowest width the caption wraps to, so a small image keeps a readable caption. */
const MIN_CAPTION_WIDTH = 240;

/** What layout needs to reserve a frame's reference: the image size and its caption. */
export interface ReferenceSize {
  width: number;
  height: number;
  caption: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameReference {
  image: Box;
  border: Box;
  caption: LaidOutText;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Places the reference of every frame that has one, and widens the room `markers` reserves
 * beside that frame so ELK and the state family layout keep the next frame out of it. A frame
 * without a list of targets gets an entry with no markers. `asideRoom` is the room local
 * routes take beside frames without a list.
 */
export function layoutReferences(
  sizes: Readonly<Record<string, ReferenceSize>>,
  screens: ReadonlyMap<string, ScreenLayout>,
  markers: Map<string, FrameMarkers>,
  asideRoom: ReadonlyMap<string, number>,
): Map<string, FrameReference> {
  const out = new Map<string, FrameReference>();
  for (const [screenId, size] of Object.entries(sizes)) {
    const screen = screens.get(screenId);
    // A frame without elements is an overview frame: it has no wireframe to compare with.
    if (screen === undefined || screen.boxes.length === 0) continue;
    const list = markers.get(screenId);
    const aside = list?.width ?? asideRoom.get(screenId) ?? 0;
    const imageX = round(screen.width + aside + REFERENCE_GAP + PAD);
    const text = wrapText(size.caption, Math.max(size.width, MIN_CAPTION_WIDTH), SMALL_FONT_SIZE);
    const measured = measureText(text, SMALL_FONT_SIZE);
    const image = { x: imageX, y: 0, width: size.width, height: size.height };
    const caption: LaidOutText = {
      text,
      fontSize: SMALL_FONT_SIZE,
      x: imageX,
      y: round(size.height + CAPTION_GAP),
      width: measured.width,
      height: measured.height,
    };
    const border = {
      x: round(imageX - PAD),
      y: -PAD,
      width: round(Math.max(size.width, measured.width) + 2 * PAD),
      height: round(PAD + size.height + CAPTION_GAP + measured.height + PAD),
    };
    out.set(screenId, { image, border, caption });
    markers.set(screenId, {
      markers: list?.markers ?? [],
      width: Math.ceil(border.x + border.width - screen.width),
      bottom: Math.ceil(Math.max(list?.bottom ?? 0, border.y + border.height)),
    });
  }
  return out;
}
