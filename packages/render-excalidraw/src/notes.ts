import type { PlacedNote } from "@groundboard/layout/types";
import {
  arrow,
  type Common,
  type ExcalidrawElement,
  freedraw,
  line,
  shape,
  text,
} from "./elements.ts";

/** Element id of an overlay note; no board item's id starts with `note/`. */
export const noteElementId = (id: string) => `note/${id}`;

/**
 * The notes of a layout overlay as Excalidraw elements, marked as the person's own in
 * `customData`, so the viewer can tell them from what the board draws. Only the checked fields
 * of a note are carried over: never a link, an image or an embed.
 */
export function renderNotes(notes: readonly PlacedNote[]): ExcalidrawElement[] {
  return notes.map((note) => {
    const common: Common = {
      id: noteElementId(note.id),
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      angle: note.angle ?? 0,
      ...(note.strokeColor !== undefined ? { strokeColor: note.strokeColor } : {}),
      ...(note.backgroundColor !== undefined ? { backgroundColor: note.backgroundColor } : {}),
      ...(note.fillStyle === "solid" || note.fillStyle === "hachure"
        ? { fillStyle: note.fillStyle }
        : {}),
      ...(note.strokeWidth !== undefined ? { strokeWidth: note.strokeWidth } : {}),
      ...(note.strokeStyle !== undefined ? { strokeStyle: note.strokeStyle } : {}),
      ...(note.roughness !== undefined ? { roughness: note.roughness } : {}),
      ...(note.opacity !== undefined ? { opacity: note.opacity } : {}),
      customData: { groundboard: { overlay: true, noteId: note.id } },
    };
    const points = (note.points ?? [
      [0, 0],
      [note.width, note.height],
    ]) as [number, number][];
    switch (note.type) {
      case "rectangle":
      case "ellipse":
      case "diamond":
        return shape(note.type, common);
      case "text":
        return text({
          ...common,
          text: note.text ?? "",
          fontSize: note.fontSize ?? 20,
          textAlign: "left",
          verticalAlign: "top",
        });
      case "arrow":
        return arrow({
          ...common,
          points,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        });
      case "line":
        return line({ ...common, points });
      default:
        return freedraw({ ...common, points });
    }
  });
}
