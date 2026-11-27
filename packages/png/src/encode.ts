import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Encodes the `width` × `height` part at (`x`, `y`) of an RGBA image `stride` pixels wide as an
 * 8-bit RGBA PNG, unfiltered rows. Used for tiles, which are cut from one raster of the board.
 */
export function encodeRgbaRegion(
  pixels: Uint8Array,
  stride: number,
  region: { x: number; y: number; width: number; height: number },
): Uint8Array {
  const { x, y, width, height } = region;
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let r = 0; r < height; r++) {
    const from = ((y + r) * stride + x) * 4;
    raw.set(pixels.subarray(from, from + row), r * (row + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const png = Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
