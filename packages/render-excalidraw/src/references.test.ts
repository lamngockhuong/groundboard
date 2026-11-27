import { readFileSync } from "node:fs";
import path from "node:path";
import { layoutBoard, type ReferenceSize } from "@groundboard/layout";
import {
  type Board,
  designChanged,
  FigmaCacheEntrySchema,
  figmaCacheName,
  parseBoard,
} from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import type { ExcalidrawElement } from "./elements.ts";
import { type ReferenceImage, referenceCaption } from "./references.ts";
import { renderExcalidraw } from "./render.ts";

const fixture = path.resolve(import.meta.dirname, "../../../examples/fixtures/figma");

function loadBoard(): Board {
  const input = JSON.parse(
    readFileSync(path.join(fixture, ".groundboard/web--users.board.json"), "utf8"),
  );
  const parsed = parseBoard(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

/** The cached images of the fixture, as the pipeline would load them. */
function loadImages(board: Board): {
  images: Map<string, ReferenceImage>;
  sizes: Record<string, ReferenceSize>;
} {
  const images = new Map<string, ReferenceImage>();
  const sizes: Record<string, ReferenceSize> = {};
  for (const node of board.nodes) {
    if (node.kind !== "screen") continue;
    const figma = board.sources.find((s) => s.id === node.sourceIds[0]);
    if (figma?.kind !== "figma") continue;
    const name = figmaCacheName(figma);
    const entry = FigmaCacheEntrySchema.parse(
      JSON.parse(readFileSync(path.join(fixture, "figma-cache", `${name}.json`), "utf8")),
    );
    const png = readFileSync(path.join(fixture, "figma-cache", `${name}.png`));
    const image: ReferenceImage = {
      figma: { fileKey: figma.fileKey, nodeId: figma.nodeId },
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      fetchedAt: entry.fetchedAt,
      designChanged: designChanged(entry),
      originX: entry.image.originX,
      originY: entry.image.originY,
      nodes: entry.nodes,
    };
    images.set(node.id, image);
    sizes[node.id] = {
      width: entry.image.width,
      height: entry.image.height,
      caption: referenceCaption(image),
    };
  }
  return { images, sizes };
}

async function render(withReferences: boolean) {
  const board = loadBoard();
  const { images, sizes } = loadImages(board);
  const laidOut = await layoutBoard(board, withReferences ? { references: sizes } : {});
  const scene = renderExcalidraw(laidOut, board, withReferences ? { references: images } : {});
  return { board, images, laidOut, scene, byId: new Map(scene.elements.map((e) => [e.id, e])) };
}

const box = (el: ExcalidrawElement) => ({
  x: el.x,
  y: el.y,
  right: el.x + el.width,
  bottom: el.y + el.height,
});
const overlaps = (a: ExcalidrawElement, b: ExcalidrawElement) => {
  const p = box(a);
  const q = box(b);
  return p.x < q.right && q.x < p.right && p.y < q.bottom && q.y < p.bottom;
};
const get = (byId: Map<string, ExcalidrawElement>, id: string) => {
  const el = byId.get(id);
  if (el === undefined) throw new Error(`no element ${id}`);
  return el;
};

describe("reference images", () => {
  test("without images the scene is the one rendered before references existed", async () => {
    const board = loadBoard();
    const plain = renderExcalidraw(await layoutBoard(board), board);
    const empty = renderExcalidraw(await layoutBoard(board, { references: {} }), board, {
      references: new Map(),
    });
    expect(empty).toEqual(plain);
    expect(plain.files).toEqual({});
    expect(plain.elements.some((e) => e.id.startsWith("refimg/"))).toBe(false);
  });

  test("one image per frame, with its border and caption, locked and grouped", async () => {
    const { scene, byId } = await render(true);
    const image = get(byId, "refimg/users");
    expect(image.type).toBe("image");
    expect(image.type === "image" && scene.files[image.fileId]?.dataURL).toMatch(
      /^data:image\/png;base64,/,
    );
    expect([image.width, image.height]).toEqual([980, 420]);
    const parts = ["refimg/users/border", "refimg/users", "refimg/users/caption"].map((id) =>
      get(byId, id),
    );
    for (const part of parts) {
      expect(part.locked).toBe(true);
      expect(part.groupIds).toEqual(["refimg/users/group"]);
      expect(part.customData).toEqual({
        groundboard: expect.objectContaining({
          kind: "reference-image",
          figma: {
            fileKey: "AbCdEf0123456789",
            nodeId: "10:1",
            url: "https://www.figma.com/design/AbCdEf0123456789?node-id=10-1",
          },
        }),
      });
    }
    const caption = get(byId, "refimg/users/caption");
    expect(caption.type === "text" && caption.text).toBe(
      "Figma reference (node 10:1) · fetched 2026-11-20 · not re-checkable",
    );
    const border = box(get(byId, "refimg/users/border"));
    expect(border.x).toBeLessThan(image.x);
    expect(border.right).toBeGreaterThan(image.x + image.width);
    expect(border.bottom).toBeGreaterThan(caption.y + caption.height);
  });

  test("the image sits right of the frame and its target list, top-aligned, overlapping nothing", async () => {
    const { scene, byId } = await render(true);
    const frame = get(byId, "node/users");
    const image = get(byId, "refimg/users");
    expect(image.y).toBe(frame.y);
    for (const id of ["ref-line/to-help", "ref-line/to-new"]) {
      const line = get(byId, id);
      expect(image.x).toBeGreaterThanOrEqual(line.x + line.width + 120);
    }
    const border = get(byId, "refimg/users/border");
    const others = scene.elements.filter((e) => !e.id.startsWith("refimg/"));
    for (const other of others) {
      if (other.type === "line" || other.type === "arrow") continue;
      expect(overlaps(border, other), other.id).toBe(false);
    }
    expect(get(byId, "legend").x).toBeGreaterThan(border.x + border.width);
  });

  test("images lie under the board, so a crossing arrow stays visible; overlays lie over it", async () => {
    const { scene } = await render(true);
    const index = (id: string) => scene.elements.findIndex((e) => e.id === id);
    expect(index("refimg/users")).toBeLessThan(index("edge/to-confirm"));
    expect(index("refimg/users")).toBeLessThan(index("node/users"));
    expect(index("refimg/users/node/add")).toBeGreaterThan(index("node/users"));
  });

  test("the next frame of the family starts after the reserved width", async () => {
    const { byId } = await render(true);
    const border = get(byId, "refimg/users/border");
    const next = get(byId, "node/confirm");
    expect(next.x).toBeGreaterThan(border.x + border.width);
    const without = (await render(false)).byId;
    expect(get(without, "node/confirm").x).toBeLessThan(next.x);
  });

  test("a box per cited layer at image + origin + box, with the element's data", async () => {
    const { byId, images } = await render(true);
    const image = get(byId, "refimg/users");
    const cached = images.get("users") as ReferenceImage;
    const expectAt = (elementId: string, nodeId: string) => {
      const overlay = get(byId, `refimg/users/node/${elementId}`);
      const [x, y, w, h] = cached.nodes[nodeId] as [number, number, number, number];
      expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([
        image.x + 10 + x,
        image.y + 6 + y,
        w,
        h,
      ]);
      expect(overlay.locked).toBe(false);
      expect(overlay.customData).toEqual(get(byId, `node/${elementId}`).customData);
    };
    expectAt("add", "10:5");
    expectAt("logo", "I10:3;5:1"); // a layer inside an instance
    expectAt("help", "10:9");
    // An element citing no layer, or a layer the cache has no box for, gets no box.
    expect(byId.has("refimg/users/node/empty")).toBe(false);
    expect(byId.has("refimg/users/node/toolbar")).toBe(false);
  });

  test("style follows the wireframe: interactive solid blue, others dashed grey, unresolved orange", async () => {
    const { byId } = await render(true);
    const add = get(byId, "refimg/users/node/add");
    const heading = get(byId, "refimg/users/node/heading");
    const search = get(byId, "refimg/users/node/search");
    expect([add.strokeColor, add.strokeStyle]).toEqual(["#1971c2", "solid"]);
    expect([heading.strokeColor, heading.strokeStyle]).toEqual(["#7d848b", "dashed"]);
    expect(search.strokeColor).toBe("#bd6e00");
  });

  test("the action dot for elements with an action, none for an unresolved one", async () => {
    const { byId } = await render(true);
    expect(get(byId, "refimg/users/node/add/action").type).toBe("ellipse");
    expect(get(byId, "refimg/users/node/help/action").type).toBe("ellipse");
    expect(byId.has("refimg/users/node/search/action")).toBe(false);
    expect(byId.has("refimg/users/node/heading/action")).toBe(false);
    const add = get(byId, "refimg/users/node/add");
    expect(get(byId, "refimg/users/node/add/action").groupIds).toEqual(add.groupIds);
  });

  test("tags carry the same numbers as the frame's tags, and the edge's data", async () => {
    const { byId } = await render(true);
    for (const edgeId of ["to-help", "to-new"]) {
      const frameTag = get(byId, `ref-tag/${edgeId}/number`);
      const copy = get(byId, `refimg/users/tag/${edgeId}/number`);
      expect(copy.type === "text" && copy.text).toBe(frameTag.type === "text" && frameTag.text);
      expect(copy.customData).toEqual(frameTag.customData);
    }
    // The copy sits on the overlay box's top-right corner as the tag sits on the element.
    const overlay = get(byId, "refimg/users/node/add");
    const tag = get(byId, "refimg/users/tag/to-new");
    expect(tag.x + tag.width).toBeGreaterThan(overlay.x + overlay.width);
    expect(tag.y).toBeLessThan(overlay.y);
  });

  test("ids never collide, even for a state named after a screen and one of its elements", async () => {
    // Joined with "-", the state `users-add` and the element `add` of `users` would share ids.
    const board = loadBoard();
    const rename = (id: string) => (id === "confirm" ? "users-add" : id);
    for (const node of board.nodes) {
      node.id = rename(node.id);
      if (node.parentId !== undefined) node.parentId = rename(node.parentId);
    }
    for (const edge of board.edges) if (edge.to !== undefined) edge.to = rename(edge.to);
    const { images, sizes } = loadImages(board);
    const scene = renderExcalidraw(await layoutBoard(board, { references: sizes }), board, {
      references: images,
    });
    const ids = scene.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("refimg/users-add");
    expect(ids).toContain("refimg/users/node/add");
  });

  test("a state frame with its own Figma node gets its own image", async () => {
    const { byId, scene } = await render(true);
    const image = get(byId, "refimg/confirm");
    expect(image.y).toBe(get(byId, "node/confirm").y);
    expect(Object.keys(scene.files).sort()).toEqual([
      "refimg/AbCdEf0123456789-10-1",
      "refimg/AbCdEf0123456789-20-1",
    ]);
    expect(byId.has("refimg/confirm/node/confirm-ok")).toBe(true);
  });

  test("a newer file found by a later check puts 'design changed since fetch' in the caption", async () => {
    const { byId } = await render(true);
    const caption = get(byId, "refimg/confirm/caption");
    expect(caption.type === "text" && caption.text).toContain("design changed since fetch");
    expect(caption.strokeColor).toBe("#c44b0a");
    const users = get(byId, "refimg/users/caption");
    expect(users.type === "text" && users.text).not.toContain("design changed");
  });

  test("the legend explains the overlay only when an image is drawn", async () => {
    const withImages = await render(true);
    const without = await render(false);
    expect(get(withImages.byId, "refimg/legend-label/reference")).toMatchObject({
      text: "Figma reference: boxes and numbers match the wireframe",
    });
    expect(without.byId.has("refimg/legend-label/reference")).toBe(false);
  });
});
