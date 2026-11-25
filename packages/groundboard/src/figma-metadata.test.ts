import { readFileSync } from "node:fs";
import path from "node:path";
import { parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import {
  canonicalOutline,
  citedLayers,
  contentHash,
  frameOrigin,
  isGroupLayer,
  layerBoxes,
  MetadataError,
  mergeInstances,
  parseMetadataXml,
  pixelHash,
} from "./figma-metadata.ts";
import { decodePng, encodePng } from "./png.ts";

const fixture = path.resolve(import.meta.dirname, "../../../examples/fixtures/figma");
const xml = (name: string) => readFileSync(path.join(fixture, "metadata", `${name}.xml`), "utf8");
const FRAME = xml("AbCdEf0123456789-10-1");
const LOGO = xml("AbCdEf0123456789-I10-3");

const SMALL = `<frame id="1:1" name="Card" x="0" y="0" width="200" height="100">
  <text id="1:2" name="Title" x="10" y="10" width="120" height="20" />
  <frame id="1:3" name="Row" x="10" y="40" width="180" height="40">
    <rectangle id="1:4" name="Swatch" x="4.004" y="4" width="32" height="32" />
  </frame>
</frame>`;

describe("parseMetadataXml", () => {
  test("reads ids, types, names, numbers and hidden layers", () => {
    const frame = parseMetadataXml(FRAME);
    expect(frame).toMatchObject({ id: "10:1", type: "frame", name: "Users", width: 960 });
    expect(frame.children.map((c) => c.id)).toEqual(["10:2", "10:4", "10:7", "10:10"]);
    expect(frame.children.at(-1)?.hidden).toBe(true);
  });

  test("ignores the text around the answer, comments and the XML declaration", () => {
    const wrapped = `Here is the metadata:\n<?xml version="1.0"?>\n<!-- frame -->\n${SMALL}\nUse it well.`;
    expect(contentHash(parseMetadataXml(wrapped))).toBe(contentHash(parseMetadataXml(SMALL)));
  });

  test("decodes entities in names", () => {
    const frame = parseMetadataXml(
      `<frame id="1:1" name="A &amp; B &#x2014; &quot;c&quot;" width="1" height="1"/>`,
    );
    expect(frame.name).toBe('A & B — "c"');
  });

  test.each([
    ["no element", "nothing here"],
    ["an unclosed element", '<frame id="1:1"><text id="1:2"/>'],
    ["a mismatched closing tag", '<frame id="1:1"></group>'],
  ])("refuses %s", (_what, text) => {
    expect(() => parseMetadataXml(text)).toThrow(MetadataError);
  });
});

describe("contentHash", () => {
  const hash = (text: string) => contentHash(parseMetadataXml(text));
  const base = hash(SMALL);

  test("is the same whatever the attribute order, quotes or whitespace", () => {
    const shuffled = `<frame   height='100' width="200"
        name="Card" id="1:1" y="0" x="0"><text
      width="120" height="20" id="1:2" x="10" y="10" name="Title"/><frame y="40" x="10"
      id="1:3" width="180" height="40" name="Row"><rectangle name="Swatch" id="1:4"
      height="32" width="32" y="4" x="4.0049"></rectangle></frame></frame>`;
    expect(hash(shuffled)).toBe(base);
  });

  test("ignores where the frame itself sits on the canvas", () => {
    expect(hash(SMALL.replace('x="0" y="0" width="200"', 'x="900" y="-35" width="200"'))).toBe(
      base,
    );
  });

  test.each([
    ["moving", 'x="10" y="10" width="120"', 'x="11" y="10" width="120"'],
    ["resizing", 'width="120" height="20"', 'width="121" height="20"'],
    ["hiding", 'name="Title"', 'name="Title" hidden="true"'],
    ["renaming", 'name="Title"', 'name="Heading"'],
    ["retyping", "<rectangle", "<ellipse"],
  ])("changes when %s one layer", (_what, from, to) => {
    const changed = SMALL.replace(from, to).replace("</rectangle", "</ellipse");
    expect(changed).not.toBe(SMALL);
    expect(hash(changed)).not.toBe(base);
  });

  test("changes when a layer is added or removed", () => {
    expect(
      hash(SMALL.replace("</frame>\n</frame>", '</frame>\n<text id="1:9"/></frame>')),
    ).not.toBe(base);
    expect(hash(SMALL.replace(/<text [^>]*\/>/, ""))).not.toBe(base);
  });

  test("writes numbers with at most two decimals", () => {
    expect(canonicalOutline(parseMetadataXml(SMALL))).toContain('"1:4","rectangle","Swatch",4,4,');
  });

  test("covers the layers of the instances, whatever order they are given in", () => {
    const frame = parseMetadataXml(FRAME);
    const logo = parseMetadataXml(LOGO);
    const nested = parseMetadataXml(
      `<instance id="I10:3;5:1" name="Mark" x="0" y="0" width="32" height="32"><vector id="I10:3;5:1;7:1" name="Path" x="2" y="2" width="28" height="28"/></instance>`,
    );
    const one = contentHash(mergeInstances(frame, [logo, nested]));
    expect(contentHash(mergeInstances(frame, [nested, logo]))).toBe(one);
    expect(one).not.toBe(contentHash(frame));
  });
});

describe("mergeInstances and layerBoxes", () => {
  test("places instance children from the instance's position in the frame", () => {
    const merged = mergeInstances(parseMetadataXml(FRAME), [parseMetadataXml(LOGO)]);
    const boxes = layerBoxes(merged);
    const cache = JSON.parse(
      readFileSync(path.join(fixture, "figma-cache", "AbCdEf0123456789-10-1.json"), "utf8"),
    );
    for (const [id, box] of Object.entries(cache.nodes)) expect(boxes.get(id)).toEqual(box);
  });

  // Shaped like a real get_metadata answer: a group is written <frame>, and its children's x/y
  // are in the group's own space (its parent's), as Figma's absoluteBoundingBox confirms.
  const GROUPED = `<frame id="1:1" name="Screen" x="12534" y="25375" width="2225" height="3370">
  <frame id="1:2" name="Group 1" x="1500" y="276" width="545" height="333">
    <frame id="1:3" name="Panel" x="1500" y="276" width="545" height="333">
      <instance id="1:4" name="Filter" x="288" y="31" width="235.25" height="66" />
    </frame>
    <frame id="1:5" name="Group 2" x="1532" y="307" width="236" height="270">
      <instance id="1:6" name="Input" x="1532" y="307" width="235.75" height="66" />
      <frame id="1:7" name="Menu" x="1533" y="377" width="235" height="200">
        <instance id="1:8" name="Item" x="0" y="36" width="235" height="32" />
      </frame>
    </frame>
  </frame>
  <frame id="1:9" name="Content" x="183" y="272" width="1280" height="1132">
    <text id="1:10" name="Title" x="0" y="0" width="991" height="32" />
  </frame>
</frame>`;

  test("places the children of a group in the group's own space, groups nested too", () => {
    const boxes = layerBoxes(parseMetadataXml(GROUPED));
    expect(boxes.get("1:2")).toEqual([1500, 276, 545, 333]);
    expect(boxes.get("1:3")).toEqual([1500, 276, 545, 333]);
    expect(boxes.get("1:4")).toEqual([1788, 307, 235.25, 66]); // inside a frame inside a group
    expect(boxes.get("1:6")).toEqual([1532, 307, 235.75, 66]); // inside a group inside a group
    expect(boxes.get("1:8")).toEqual([1533, 413, 235, 32]);
    expect(boxes.get("1:10")).toEqual([183, 272, 991, 32]); // a frame: relative as before
  });

  test("tells a group from a frame by its children's union", () => {
    const frame = parseMetadataXml(GROUPED);
    const [group, content] = frame.children;
    expect(group && isGroupLayer(group)).toBe(true);
    expect(content && isGroupLayer(content)).toBe(false);
    expect(isGroupLayer(frame)).toBe(false);
    // a frame whose children fill it exactly in its own space is still a frame
    const filled = parseMetadataXml(
      '<frame id="2:1" name="Row" x="16" y="120" width="928" height="36"><instance id="2:2" name="A" x="0" y="0" width="928" height="36"/></frame>',
    );
    expect(isGroupLayer(filled)).toBe(false);
    expect(
      isGroupLayer(parseMetadataXml('<group id="3:1" x="0" y="0" width="1" height="1"/>')),
    ).toBe(true);
  });

  test("refuses an instance outline that is not a layer of the frame", () => {
    const stray = parseMetadataXml('<instance id="99:1" width="1" height="1"/>');
    expect(() => mergeInstances(parseMetadataXml(FRAME), [stray])).toThrow(/99:1/);
  });
});

describe("frameOrigin", () => {
  const frame = (children: string, width = 200, height = 100) =>
    parseMetadataXml(
      `<frame id="1:1" name="F" x="0" y="0" width="${width}" height="${height}">${children}</frame>`,
    );

  test("is (0, 0) when the image has the frame's size, even with layers past its edges", () => {
    const footer = frame(
      '<frame id="1:2" name="Footer" x="-1" y="80" width="202" height="20"/><rectangle id="1:3" name="Backdrop" x="0" y="-4" width="200" height="104"/>',
    );
    expect(frameOrigin(footer, { width: 200, height: 100 })).toEqual({ ok: true, x: 0, y: 0 });
  });

  test("is the overflow of the layers when it explains the extra pixels", () => {
    const overflow = frame('<text id="1:2" name="T" x="-6" y="10" width="230" height="20"/>');
    expect(frameOrigin(overflow, { width: 230, height: 100 })).toEqual({ ok: true, x: 6, y: 0 });
  });

  test("puts effect pixels on the far side when no layer reaches the near edge", () => {
    const shadowed = frame('<frame id="1:2" name="Card" x="20" y="20" width="180" height="80"/>');
    expect(frameOrigin(shadowed, { width: 210, height: 112 })).toEqual({ ok: true, x: 0, y: 0 });
  });

  test("puts them on the near side when no layer reaches the far edge", () => {
    const header = frame('<frame id="1:2" name="Header" x="0" y="0" width="120" height="40"/>');
    expect(frameOrigin(header, { width: 228, height: 119 })).toEqual({ ok: true, x: 28, y: 19 });
  });

  test("refuses when layers reach both edges, and when the image is smaller", () => {
    const full = frame('<frame id="1:2" name="Header" x="0" y="0" width="200" height="40"/>');
    const both = frameOrigin(full, { width: 228, height: 100 });
    expect(both).toMatchObject({ ok: false });
    expect(!both.ok && both.reason).toMatch(/left and right edges/);
    const scaled = frameOrigin(full, { width: 100, height: 50 });
    expect(!scaled.ok && scaled.reason).toMatch(/scaled down/);
  });

  test("ignores hidden layers", () => {
    const hidden = frame(
      '<frame id="1:2" name="Header" x="0" y="0" width="200" height="40" hidden="true"/><text id="1:3" name="T" x="20" y="20" width="10" height="10"/>',
    );
    expect(frameOrigin(hidden, { width: 228, height: 100 })).toEqual({ ok: true, x: 0, y: 0 });
  });
});

describe("pixelHash", () => {
  test("is the same for the same pixels in differently encoded PNGs", () => {
    const original = readFileSync(path.join(fixture, "figma-cache", "AbCdEf0123456789-10-1.png"));
    const pixels = decodePng(original);
    const hash = pixelHash(pixels);
    for (const filter of [0, 1, 2] as const) {
      const reencoded = encodePng(pixels, { filter });
      expect(reencoded.equals(original)).toBe(false);
      expect(pixelHash(decodePng(reencoded))).toBe(hash);
    }
  });

  test("changes with one pixel, and with the size", () => {
    const image = { width: 2, height: 2, data: new Uint8Array(16).fill(255) };
    const hash = pixelHash(image);
    const changed = { ...image, data: image.data.slice() };
    changed.data[0] = 0;
    expect(pixelHash(changed)).not.toBe(hash);
    expect(pixelHash({ width: 4, height: 1, data: image.data })).not.toBe(hash);
  });
});

describe("citedLayers", () => {
  const board = (() => {
    const parsed = parseBoard(
      JSON.parse(readFileSync(path.join(fixture, ".groundboard", "web--users.board.json"), "utf8")),
    );
    if (!parsed.ok) throw new Error("fixture board is invalid");
    return parsed.value;
  })();

  test("lists the layers the elements of the frame's screen cite, not a state's own frame", () => {
    const cited = citedLayers(board, "10:1");
    expect(cited?.frame.nodeId).toBe("10:1");
    expect(cited?.screenIds).toEqual(["users"]);
    expect([...(cited?.layers.keys() ?? [])].sort()).toEqual(
      ["10:2", "10:4", "10:5", "10:6", "10:8", "10:9", "I10:3;5:1"].sort(),
    );
    expect(cited?.layers.get("10:5")).toEqual(["add"]);
    expect(citedLayers(board, "20:1")?.layers.get("20:3")).toEqual(["confirm-ok"]);
    expect(citedLayers(board, "99:1")).toBeUndefined();
  });
});
