import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { VERSION } from "../version.ts";
import { CliError, type CliIO, EXIT, readJsonInput } from "./io.ts";
import { parseDirection, sceneFromBoard } from "./render.ts";

/** The optional package that draws the image; installed apart, so `groundboard` stays light. */
export const PNG_PACKAGE = "@groundboard/png";

export const PNG_DEFAULTS = { maxEdge: 1568, minText: 8 } as const;
const THEMES = ["light", "dark"] as const;
const FONTS = ["sans", "board", "hand", "system", "mono"] as const;

export const pngHelp = `Usage: groundboard png <board.json | scene.excalidraw> [options]

Draw a board as a PNG image, so an agent or a reviewer can look at it. A board is laid out and
rendered as "render" does it, its layout overlay included; an .excalidraw scene is drawn as it
is. Nothing leaves the machine and no browser is started.

Needs the optional package ${PNG_PACKAGE}; without it, the command prints how to install it.

Options:
  -o, --output <file>     Output file (default: <board>.png beside the input)
      --theme <theme>     light (default) or dark
      --font <font>       Reading font, as in the viewer's font menu: sans (default, what the
                          viewer opens with), board (the font each text was drawn in), hand,
                          system or mono
      --max-edge <px>     Longest side of one image (default ${PNG_DEFAULTS.maxEdge}, the size above which
                          Claude downscales an image)
      --min-text <px>     Smallest readable text height (default ${PNG_DEFAULTS.minText}). When fitting the board
                          into --max-edge would draw text smaller, the board is drawn at scale 1
                          or more and cut into tiles <output>-r<row>c<col>.png instead
      --direction <dir>   right (default) or down, for a board
      --references        Draw the cached Figma image of each frame beside it, as "render" does
      --no-overlay        Ignore <board>.overlay.json beside a <board>.board.json
  -h, --help              Show this help

Prints the path of each image written, one per line.

Known limit: a line of text holding a character its font lacks (such as "→" in Excalifont) is
drawn wholly in a fallback font, where the viewer swaps only that character.
`;

/** What the command uses of @groundboard/png. */
export interface PngRenderer {
  renderPng(
    scene: object,
    options: {
      theme: (typeof THEMES)[number];
      font: (typeof FONTS)[number];
      maxEdge: number;
      minText: number;
    },
  ): Promise<{
    scale: number;
    width: number;
    height: number;
    rows: number;
    cols: number;
    tiles: { row: number; col: number; width: number; height: number; png: Uint8Array }[];
  }>;
}

/**
 * Loads @groundboard/png from beside this package (`npx -p`, a global or a project install), then
 * from the working directory; null when neither has it. Errors inside the package propagate.
 */
export async function loadPngRenderer(cwd: string): Promise<PngRenderer | null> {
  const from = [import.meta.url, pathToFileURL(path.join(cwd, "package.json")).href];
  for (const base of from) {
    let resolved: string;
    try {
      resolved = createRequire(base).resolve(PNG_PACKAGE);
    } catch {
      continue;
    }
    return (await import(pathToFileURL(resolved).href)) as PngRenderer;
  }
  return null;
}

/** The one command that makes @groundboard/png available to the way groundboard was started. */
export function installHint(args: string[], runningFrom = import.meta.url): string {
  const pkg = `${PNG_PACKAGE}@${VERSION}`;
  if (runningFrom.includes("/_npx/")) {
    const quoted = args.map((a) =>
      /^[\w./:@=-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`,
    );
    return `npx -y -p groundboard@${VERSION} -p ${pkg} groundboard png ${quoted.join(" ")}`;
  }
  return `npm install ${pkg}`;
}

export function defaultPngOutput(input: string): string {
  for (const suffix of [".board.json", ".excalidraw", ".json"]) {
    if (input.endsWith(suffix)) return `${input.slice(0, -suffix.length)}.png`;
  }
  return `${input}.png`;
}

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]) {
  if (value === undefined) return allowed[0] as T;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new CliError(
    EXIT.usage,
    `--${flag} must be ${allowed.map((a) => JSON.stringify(a)).join(" or ")}, not ${JSON.stringify(value)}`,
  );
}

function pixels(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(EXIT.usage, `--${flag} must be a whole number of pixels, not ${value}`);
  }
  return n;
}

export async function pngCommand(
  args: string[],
  io: CliIO,
  load: (cwd: string) => Promise<PngRenderer | null> = loadPngRenderer,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      theme: { type: "string" },
      font: { type: "string" },
      "max-edge": { type: "string" },
      "min-text": { type: "string" },
      direction: { type: "string" },
      references: { type: "boolean" },
      overlay: { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
    },
    allowNegative: true,
  });
  if (values.help) {
    io.stdout(pngHelp);
    return EXIT.ok;
  }
  if (positionals.length !== 1) throw new CliError(EXIT.usage, "png takes exactly one file");
  const input = positionals[0] as string;
  const options = {
    theme: oneOf("theme", values.theme, THEMES),
    font: oneOf("font", values.font, FONTS),
    maxEdge: pixels("max-edge", values["max-edge"], PNG_DEFAULTS.maxEdge),
    minText: pixels("min-text", values["min-text"], PNG_DEFAULTS.minText),
  };
  const direction = parseDirection(values.direction);
  const output = values.output ?? (input === "-" ? undefined : defaultPngOutput(input));
  if (output === undefined) throw new CliError(EXIT.usage, "reading stdin needs --output <file>");

  // Checked before any work, so a missing package costs nothing but the message.
  const renderer = await load(io.cwd);
  if (!renderer) {
    io.stderr(
      `groundboard png: drawing images needs the optional package ${PNG_PACKAGE}, which is not installed. Run:\n\n  ${installHint(args)}\n`,
    );
    return EXIT.io;
  }

  const json = await readJsonInput(input === "-" ? "-" : path.resolve(io.cwd, input), io);
  const isScene =
    typeof json === "object" && json !== null && (json as { type?: unknown }).type === "excalidraw";
  const scene = isScene
    ? json
    : await sceneFromBoard(
        json,
        input,
        { direction, overlay: values.overlay ?? true, references: values.references ?? false },
        io,
      );
  if (typeof scene === "number") return scene;
  if (typeof scene !== "object" || scene === null) {
    throw new CliError(EXIT.invalid, `${input} is neither a board nor an Excalidraw scene`);
  }

  const result = await renderer.renderPng(scene, options);
  const target = path.resolve(io.cwd, output);
  const tiled = result.tiles.length > 1;
  const base = target.replace(/\.png$/i, "");
  const written: string[] = [];
  try {
    await mkdir(path.dirname(target), { recursive: true });
    for (const tile of result.tiles) {
      const file = tiled ? `${base}-r${tile.row}c${tile.col}.png` : target;
      await writeFile(file, tile.png);
      written.push(file);
    }
  } catch (error) {
    throw new CliError(
      EXIT.io,
      `cannot write ${output}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
  const scale = `scale ${Number(result.scale.toFixed(3))}`;
  io.stderr(
    tiled
      ? `drew ${result.width}×${result.height} px at ${scale} as ${result.rows}×${result.cols} tiles of at most ${options.maxEdge} px (text would be under ${options.minText} px in one image)\n`
      : `drew ${result.width}×${result.height} px at ${scale}\n`,
  );
  for (const file of written) {
    const relative = path.relative(io.cwd, file);
    io.stdout(`${relative.startsWith("..") || path.isAbsolute(relative) ? file : relative}\n`);
  }
  return EXIT.ok;
}
