import { crc32, deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { decodePng, encodePng, PngError } from "./png.ts";

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A PNG from raw scanlines (each already prefixed with its filter byte). */
function png(
  header: { width: number; height: number; depth: number; type: number; interlace?: number },
  scanlines: number[][],
  extra: Array<[string, number[]]> = [],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width, 0);
  ihdr.writeUInt32BE(header.height, 4);
  ihdr[8] = header.depth;
  ihdr[9] = header.type;
  ihdr[12] = header.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map(([type, body]) => chunk(type, Buffer.from(body))),
    chunk("IDAT", deflateSync(Buffer.from(scanlines.flat()))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pixels = (data: Uint8Array) => [...data];

describe("decodePng", () => {
  test("round-trips what encodePng writes, with every filter", () => {
    const image = { width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, i) => i * 10) };
    for (const filter of [0, 1, 2] as const)
      expect(pixels(decodePng(encodePng(image, { filter })).data)).toEqual(pixels(image.data));
  });

  test("applies a palette and its transparency", () => {
    const bytes = png(
      { width: 2, height: 1, depth: 8, type: 3 },
      [[0, 0, 1]],
      [
        ["PLTE", [255, 0, 0, 0, 0, 255]],
        ["tRNS", [128]],
      ],
    );
    expect(pixels(decodePng(bytes).data)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });

  test("expands 1-bit grey and keeps the high byte of 16-bit samples", () => {
    const grey = png({ width: 3, height: 1, depth: 1, type: 0 }, [[0, 0b10100000]]);
    expect(pixels(decodePng(grey).data)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const deep = png({ width: 1, height: 1, depth: 16, type: 2 }, [
      [0, 0x12, 0x34, 0xab, 0xcd, 0xff, 0],
    ]);
    expect(pixels(decodePng(deep).data)).toEqual([0x12, 0xab, 0xff, 255]);
  });

  test("reads an Adam7-interlaced image like the same pixels without interlacing", () => {
    // 2×2 RGB: pass 1 holds (0,0), pass 6 holds (1,0), pass 7 holds row 1
    const interlaced = png({ width: 2, height: 2, depth: 8, type: 2, interlace: 1 }, [
      [0, 1, 2, 3],
      [0, 4, 5, 6],
      [0, 7, 8, 9, 10, 11, 12],
    ]);
    const plain = png({ width: 2, height: 2, depth: 8, type: 2 }, [
      [0, 1, 2, 3, 4, 5, 6],
      [0, 7, 8, 9, 10, 11, 12],
    ]);
    expect(pixels(decodePng(interlaced).data)).toEqual(pixels(decodePng(plain).data));
  });

  test.each([
    ["bytes that are not a PNG", Buffer.from("hello world")],
    ["a truncated image", png({ width: 4, height: 4, depth: 8, type: 2 }, [[0, 1, 2, 3]])],
    ["an image too large", png({ width: 20_000, height: 1, depth: 8, type: 0 }, [[0]])],
  ])("refuses %s", (_what, bytes) => {
    expect(() => decodePng(bytes)).toThrow(PngError);
  });
});
