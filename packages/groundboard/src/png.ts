import { crc32, deflateSync, inflateSync } from "node:zlib";
import { MAX_IMAGE_SIDE } from "@groundboard/schema";

/** An image as 8-bit RGBA, row by row, 4 bytes per pixel. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export class PngError extends Error {}

/**
 * Decodes a PNG of any colour type, bit depth and interlacing into 8-bit RGBA. Samples of 16
 * bits keep their high byte; palette and `tRNS` transparency are applied. Throws `PngError` on
 * anything that is not a well-formed PNG, or one larger than `MAX_IMAGE_SIDE` on a side.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngError("not a PNG");
  let offset = 8;
  let header = { width: 0, height: 0, depth: 0, type: -1, interlace: 0 };
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new PngError(`chunk ${type} is truncated`);
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8] ?? 0,
        type: body[9] ?? -1,
        interlace: body[12] ?? 0,
      };
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const { width, height, depth, type, interlace } = header;
  const channels = CHANNELS[type];
  if (channels === undefined) throw new PngError("missing or unknown IHDR colour type");
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE)
    throw new PngError(
      `a ${width}×${height} image is outside 1 to ${MAX_IMAGE_SIDE} pixels a side`,
    );
  if (![1, 2, 4, 8, 16].includes(depth)) throw new PngError(`bit depth ${depth} is not valid`);
  if (type === 3 && palette === undefined) throw new PngError("a palette image has no PLTE chunk");
  if (idat.length === 0) throw new PngError("no image data");

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    throw new PngError("the image data does not inflate");
  }
  const bitsPerPixel = channels * depth;
  const filterStep = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  const maxSample = (1 << Math.min(depth, 8)) - 1;
  const transparentKey = (() => {
    if (transparency === undefined || type === 3) return undefined;
    const key: number[] = [];
    for (let i = 0; i + 1 < transparency.length; i += 2) key.push(transparency.readUInt16BE(i));
    return key;
  })();

  const sample = (row: Buffer, index: number): number => {
    if (depth === 8) return row[index] ?? 0;
    if (depth === 16) return row.readUInt16BE(index * 2);
    const bit = index * depth;
    return ((row[bit >> 3] ?? 0) >> (8 - depth - (bit & 7))) & maxSample;
  };
  const to8 = (value: number): number => {
    if (depth === 16) return value >> 8;
    if (depth === 8) return value;
    return Math.round((value * 255) / maxSample);
  };
  const put = (row: Buffer, column: number, target: number) => {
    const base = column * channels;
    if (type === 3) {
      const index = sample(row, base);
      out[target] = palette?.[index * 3] ?? 0;
      out[target + 1] = palette?.[index * 3 + 1] ?? 0;
      out[target + 2] = palette?.[index * 3 + 2] ?? 0;
      out[target + 3] = transparency?.[index] ?? 255;
      return;
    }
    const values: number[] = [];
    for (let c = 0; c < channels; c++) values.push(sample(row, base + c));
    const [first = 0, second = 0, third = 0, fourth = 0] = values;
    if (type === 0 || type === 4) {
      const grey = to8(first);
      out[target] = grey;
      out[target + 1] = grey;
      out[target + 2] = grey;
      out[target + 3] = type === 4 ? to8(second) : transparentKey?.[0] === first ? 0 : 255;
      return;
    }
    out[target] = to8(first);
    out[target + 1] = to8(second);
    out[target + 2] = to8(third);
    const keyed =
      transparentKey !== undefined &&
      transparentKey[0] === first &&
      transparentKey[1] === second &&
      transparentKey[2] === third;
    out[target + 3] = type === 6 ? to8(fourth) : keyed ? 0 : 255;
  };

  let position = 0;
  const passes = interlace === 1 ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const stride = Math.ceil((passWidth * bitsPerPixel) / 8);
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < passHeight; y++) {
      if (position + 1 + stride > raw.length) throw new PngError("the image data is truncated");
      const filter = raw[position] ?? 0;
      const row = Buffer.from(raw.subarray(position + 1, position + 1 + stride));
      position += 1 + stride;
      unfilter(filter, row, previous, filterStep);
      for (let x = 0; x < passWidth; x++) {
        put(row, x, ((y0 + y * dy) * width + x0 + x * dx) * 4);
      }
      previous = row;
    }
  }
  return { width, height, data: out };
}

function unfilter(filter: number, row: Buffer, previous: Buffer, step: number): void {
  for (let i = 0; i < row.length; i++) {
    const left = i >= step ? (row[i - step] ?? 0) : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= step ? (previous[i - step] ?? 0) : 0;
    const value = row[i] ?? 0;
    switch (filter) {
      case 0:
        break;
      case 1:
        row[i] = value + left;
        break;
      case 2:
        row[i] = value + up;
        break;
      case 3:
        row[i] = value + ((left + up) >> 1);
        break;
      case 4: {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[i] = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        break;
      }
      default:
        throw new PngError(`unknown row filter ${filter}`);
    }
  }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes 8-bit RGBA as a non-interlaced PNG. */
export function encodePng(image: RgbaImage, options: { filter?: 0 | 1 | 2 } = {}): Buffer {
  const { width, height, data } = image;
  const filter = options.filter ?? 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    raw[at] = filter;
    for (let i = 0; i < stride; i++) {
      const value = data[y * stride + i] ?? 0;
      const left = i >= 4 ? (data[y * stride + i - 4] ?? 0) : 0;
      const up = y > 0 ? (data[(y - 1) * stride + i] ?? 0) : 0;
      raw[at + 1 + i] = (value - (filter === 1 ? left : filter === 2 ? up : 0)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
