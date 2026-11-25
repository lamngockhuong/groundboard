import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CACHE_GITIGNORE,
  FIGMA_CACHE_DIR,
  type FigmaCacheEntry,
  FigmaCacheEntrySchema,
  figmaCacheName,
  MAX_CACHED_NODES,
  parseBoard,
} from "@groundboard/schema";
import { drawCheckImage } from "../check-image.ts";
import {
  type Box,
  citedLayers,
  contentHash,
  type FigmaLayer,
  frameOrigin,
  layerBoxes,
  MetadataError,
  mergeInstances,
  parseMetadataXml,
  pixelHash,
} from "../figma-metadata.ts";
import { decodePng, encodePng, PngError, type RgbaImage } from "../png.ts";
import { CliError, type CliIO, EXIT, formatIssues, readJsonInput } from "./io.ts";

/** Largest metadata outline or image `figma entry` reads. */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const figmaHelp = `Usage: groundboard figma <command> [options]

Commands:
  entry <board.json>   Write or check the reference-image cache entry of one Figma frame

Run "groundboard figma entry --help" for its options.
`;

export const figmaEntryHelp = `Usage: groundboard figma entry <board.json> --frame <frame.xml> [--instance <xml>...]
                              [--image <frame.png>] [--origin <x>,<y>] [--check]
                              [--check-image <out.png>]

Write ${FIGMA_CACHE_DIR}/<name>.json next to the board for the Figma frame whose get_metadata
answer is <frame.xml>: the box of every layer the board's elements cite in that frame, where
the frame lies inside the image, and the hashes that later tell whether the design changed.
Layers inside an instance need the get_metadata answer of that instance (--instance, once per
instance; an instance may sit inside another one). The image is copied to <name>.png beside
the entry. When the entry already exists with the same outline hash, the boxes it holds for
other boards are kept; when the outline changed, they are replaced.

Options:
      --frame <file>        The frame's get_metadata answer, saved verbatim (required)
      --instance <file>     An instance's get_metadata answer (repeatable)
      --image <file>        The frame's PNG from get_screenshot (required unless --check)
      --origin <x>,<y>      The frame's top-left corner inside the image, when the command
                            cannot tell it from the image and the outline
      --check               Only compare: record checkedAt and the checked hashes (of the
                            outline, and of the pixels when --image is given) in the existing
                            entry, leaving the image and the boxes alone
      --check-image <file>  Also write the image with the frame outline and every cited box,
                            labelled with its element ids
  -h, --help                Show this help

Exit codes: 0 ok, 1 I/O error, 2 bad arguments, 3 invalid board, outline or image.
`;

async function readInput(file: string, what: string): Promise<Buffer> {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new CliError(EXIT.io, `${what} ${file} is not a file`);
    if (info.size > MAX_INPUT_BYTES)
      throw new CliError(EXIT.io, `${what} ${file} is larger than ${MAX_INPUT_BYTES} bytes`);
    return await readFile(file);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      EXIT.io,
      `cannot read ${what} ${file}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
}

async function readOutline(file: string, what: string): Promise<FigmaLayer> {
  const text = (await readInput(file, what)).toString("utf8");
  try {
    return parseMetadataXml(text);
  } catch (error) {
    if (error instanceof MetadataError)
      throw new CliError(EXIT.invalid, `${what} ${file}: ${error.message}`);
    throw error;
  }
}

async function readImage(file: string): Promise<RgbaImage> {
  const bytes = await readInput(file, "image");
  try {
    return decodePng(bytes);
  } catch (error) {
    if (error instanceof PngError)
      throw new CliError(EXIT.invalid, `image ${file}: ${error.message}`);
    throw error;
  }
}

function parseOrigin(value: string): { x: number; y: number } {
  const match = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match)
    throw new CliError(
      EXIT.usage,
      `--origin must be two non-negative numbers "x,y", not ${JSON.stringify(value)}`,
    );
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function readEntry(file: string): Promise<FigmaCacheEntry | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliError(
      EXIT.io,
      `cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined; // unusable: written again from scratch
  }
  const parsed = FigmaCacheEntrySchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

async function writeOut(file: string, data: string | Uint8Array): Promise<void> {
  try {
    await writeFile(file, data);
  } catch (error) {
    throw new CliError(
      EXIT.io,
      `cannot write ${file}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
}

/** Creates the cache directory and, beside it, the `.gitignore` that keeps it out of git. */
async function prepareCache(cacheDir: string): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
  } catch (error) {
    throw new CliError(
      EXIT.io,
      `cannot create ${cacheDir}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
  const ignore = path.join(path.dirname(cacheDir), ".gitignore");
  try {
    await stat(ignore);
  } catch {
    await writeOut(ignore, CACHE_GITIGNORE);
  }
}

const sameFile = async (a: string, b: string) => {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
};

const short = (hash: string) => hash.slice(0, 12);

async function figmaEntryCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      frame: { type: "string" },
      instance: { type: "string", multiple: true },
      image: { type: "string" },
      origin: { type: "string" },
      check: { type: "boolean" },
      "check-image": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.stdout(figmaEntryHelp);
    return EXIT.ok;
  }
  if (positionals.length !== 1)
    throw new CliError(EXIT.usage, "figma entry takes exactly one board file");
  if (values.frame === undefined) throw new CliError(EXIT.usage, "--frame <frame.xml> is required");
  if (!values.check && values.image === undefined)
    throw new CliError(EXIT.usage, "--image <frame.png> is required unless --check");
  if (values["check-image"] !== undefined && values.image === undefined)
    throw new CliError(EXIT.usage, "--check-image needs --image");
  const origin = values.origin === undefined ? undefined : parseOrigin(values.origin);
  const resolve = (file: string) => path.resolve(io.cwd, file);
  const display = (file: string) => path.relative(io.cwd, file) || ".";

  const boardFile = resolve(positionals[0] as string);
  const parsed = parseBoard(await readJsonInput(boardFile, io));
  if (!parsed.ok)
    throw new CliError(
      EXIT.invalid,
      `${positionals[0]}: ${parsed.error.length} issue(s)\n${formatIssues(parsed.error)}`,
    );
  const board = parsed.value;

  const frameOutline = await readOutline(resolve(values.frame), "frame outline");
  const instances: FigmaLayer[] = [];
  for (const file of values.instance ?? [])
    instances.push(await readOutline(resolve(file), "instance outline"));
  let outline: FigmaLayer;
  try {
    outline = mergeInstances(frameOutline, instances);
  } catch (error) {
    if (error instanceof MetadataError) throw new CliError(EXIT.invalid, error.message);
    throw error;
  }
  const cited = citedLayers(board, outline.id);
  if (cited === undefined)
    throw new CliError(
      EXIT.invalid,
      `no screen of ${positionals[0]} cites Figma node ${outline.id}, the frame of ${values.frame}`,
    );
  const name = figmaCacheName(cited.frame);
  const cacheDir = path.join(path.dirname(boardFile), FIGMA_CACHE_DIR);
  const entryFile = path.join(cacheDir, `${name}.json`);
  const hash = contentHash(outline);
  const imageFile = values.image === undefined ? undefined : resolve(values.image);
  const image = imageFile === undefined ? undefined : await readImage(imageFile);

  const allBoxes = layerBoxes(outline);
  const boxes = new Map<string, Box>();
  const missing: string[] = [];
  for (const [nodeId, elementIds] of cited.layers) {
    const box = allBoxes.get(nodeId);
    if (box) boxes.set(nodeId, box);
    else missing.push(`${elementIds.map((id) => `\`${id}\``).join(", ")} cite(s) ${nodeId}`);
  }

  const existing = await readEntry(entryFile);
  // a check keeps the recorded origin; it needs one only to draw a check image
  let frameAt =
    origin ??
    (values.check && existing !== undefined
      ? { x: existing.image.originX, y: existing.image.originY }
      : undefined);
  if (image !== undefined && frameAt === undefined) {
    const found = frameOrigin(outline, image);
    if (!found.ok)
      throw new CliError(
        EXIT.usage,
        `cannot tell where frame ${outline.id} lies inside ${values.image}: ${found.reason}. Read a check image (--check-image with --origin 0,0) and pass --origin <x>,<y>`,
      );
    frameAt = { x: found.x, y: found.y };
  }

  if (values["check-image"] !== undefined && image !== undefined && frameAt !== undefined) {
    const labelled = [...boxes].map(([nodeId, box]) => ({
      box,
      label: (cited.layers.get(nodeId) ?? []).join(","),
    }));
    const drawn = drawCheckImage(image, outline, frameAt, labelled);
    const out = resolve(values["check-image"]);
    await writeOut(out, encodePng(drawn));
    io.stderr(`wrote check image ${display(out)}\n`);
  }
  for (const line of missing)
    io.stderr(
      `warning: ${line}, which the outline does not hold: pass the get_metadata answer of its instance with --instance\n`,
    );

  const now = new Date().toISOString();

  if (values.check) {
    if (existing === undefined)
      throw new CliError(
        EXIT.invalid,
        `no usable cache entry ${display(entryFile)} to check; write it first without --check`,
      );
    const pixels = image === undefined ? undefined : pixelHash(image);
    const updated: FigmaCacheEntry = {
      ...existing,
      // an entry written before hashes existed takes this check as its baseline
      ...(existing.contentHash === undefined ? { contentHash: hash } : {}),
      ...(existing.pixelHash === undefined && pixels !== undefined ? { pixelHash: pixels } : {}),
      checkedAt: now,
      checkedContentHash: hash,
      ...(pixels !== undefined ? { checkedPixelHash: pixels } : {}),
    };
    await writeOut(entryFile, `${JSON.stringify(updated, null, 2)}\n`);
    const outlineState =
      existing.contentHash === undefined
        ? "outline recorded as the baseline (the entry had no hash)"
        : existing.contentHash === hash
          ? "outline unchanged"
          : "outline changed since fetch";
    const pixelState =
      pixels === undefined
        ? "pixels not checked"
        : existing.pixelHash === undefined
          ? "pixels recorded as the baseline (the entry had no hash)"
          : existing.pixelHash === pixels
            ? "pixels unchanged"
            : "pixels changed since fetch";
    io.stdout(`checked ${display(entryFile)}: ${outlineState}; ${pixelState}\n`);
    return EXIT.ok;
  }

  if (image === undefined || imageFile === undefined || frameAt === undefined)
    throw new CliError(EXIT.usage, "--image <frame.png> is required unless --check");
  const kept =
    existing !== undefined && existing.contentHash === hash
      ? Object.entries(existing.nodes).filter(([nodeId]) => !boxes.has(nodeId))
      : [];
  const nodes: Record<string, Box> = Object.fromEntries([...kept, ...boxes]);
  if (Object.keys(nodes).length > MAX_CACHED_NODES)
    throw new CliError(EXIT.invalid, `the entry would hold more than ${MAX_CACHED_NODES} boxes`);
  const entry: FigmaCacheEntry = {
    fileKey: cited.frame.fileKey,
    nodeId: cited.frame.nodeId,
    fetchedAt: now,
    contentHash: hash,
    pixelHash: pixelHash(image),
    image: { width: image.width, height: image.height, originX: frameAt.x, originY: frameAt.y },
    nodes,
  };
  const valid = FigmaCacheEntrySchema.safeParse(entry);
  if (!valid.success) {
    const issue = valid.error.issues[0];
    throw new CliError(
      EXIT.invalid,
      `the entry is not valid: ${issue?.path.join(".")}: ${issue?.message}`,
    );
  }
  await prepareCache(cacheDir);
  const pngFile = path.join(cacheDir, `${name}.png`);
  if (!(await sameFile(imageFile, pngFile))) {
    try {
      await copyFile(imageFile, pngFile);
    } catch (error) {
      throw new CliError(
        EXIT.io,
        `cannot write ${display(pngFile)}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
      );
    }
  }
  await writeOut(entryFile, `${JSON.stringify(valid.data, null, 2)}\n`);
  const merge =
    existing === undefined
      ? ""
      : existing.contentHash === hash
        ? `, ${kept.length} kept from the earlier entry (same outline)`
        : existing.contentHash === undefined
          ? ", the earlier entry replaced (it had no outline hash)"
          : ", the earlier entry replaced (the outline changed)";
  io.stdout(
    `wrote ${display(entryFile)}: ${boxes.size} box(es) for this board${merge}; origin (${frameAt.x}, ${frameAt.y}); outline ${short(hash)}\n`,
  );
  return EXIT.ok;
}

export async function figmaCommand(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "-h" || sub === "--help") {
    io.stdout(figmaHelp);
    return sub === undefined ? EXIT.usage : EXIT.ok;
  }
  if (sub === "entry") return figmaEntryCommand(rest, io);
  throw new CliError(EXIT.usage, `unknown figma command ${JSON.stringify(sub)}\n\n${figmaHelp}`);
}
