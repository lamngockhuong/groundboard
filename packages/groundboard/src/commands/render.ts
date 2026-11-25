import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { FIGMA_CACHE_DIR } from "@groundboard/schema";
import { BOARD_FILE_SUFFIX } from "../fs-confined.ts";
import { type OverlayRead, readOverlayFile } from "../overlay-file.ts";
import { renderBoard } from "../pipeline.ts";
import { CliError, type CliIO, EXIT, formatIssues, readJsonInput } from "./io.ts";

export const renderHelp = `Usage: groundboard render <board.json> [options]

Validate a board, lay it out and write an .excalidraw scene.

Options:
  -o, --output <file>        Output file; "-" for stdout (default: <board>.excalidraw)
      --direction <dir>      right (default) or down
      --check-sources <root> Check every cited quote against the files under <root>
      --references           Draw the cached Figma image of each frame beside it, read from
                             ${FIGMA_CACHE_DIR}/ next to the board (.groundboard/${FIGMA_CACHE_DIR}/
                             for stdin); the images are embedded in the output
      --no-overlay           Ignore <board>.overlay.json beside a <board>.board.json: the
                             boxes moved and the notes drawn in the viewer
  -h, --help                 Show this help

The layout overlay <board>.overlay.json beside <board>.board.json is applied when it exists;
one that does not match the overlay schema is skipped with a warning.
`;

export function defaultOutput(input: string): string {
  if (input === "-") return "-";
  if (input.endsWith(".board.json")) return `${input.slice(0, -".board.json".length)}.excalidraw`;
  if (input.endsWith(".json")) return `${input.slice(0, -".json".length)}.excalidraw`;
  return `${input}.excalidraw`;
}

export function parseDirection(value: string | undefined): "right" | "down" {
  if (value === undefined || value === "right" || value === "down") return value ?? "right";
  throw new CliError(
    EXIT.usage,
    `--direction must be "right" or "down", not ${JSON.stringify(value)}`,
  );
}

export async function renderCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      direction: { type: "string" },
      "check-sources": { type: "string" },
      references: { type: "boolean" },
      overlay: { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
    },
    allowNegative: true,
  });
  if (values.help) {
    io.stdout(renderHelp);
    return EXIT.ok;
  }
  if (positionals.length !== 1)
    throw new CliError(EXIT.usage, "render takes exactly one board file");
  const input = positionals[0] as string;
  const direction = parseDirection(values.direction);
  const board = await readJsonInput(input === "-" ? "-" : path.resolve(io.cwd, input), io);
  const checkRoot = values["check-sources"];
  const cacheDir =
    input === "-"
      ? path.resolve(io.cwd, ".groundboard", FIGMA_CACHE_DIR)
      : path.resolve(path.dirname(path.resolve(io.cwd, input)), FIGMA_CACHE_DIR);
  const overlay =
    values.overlay && input.endsWith(BOARD_FILE_SUFFIX)
      ? await overlayBeside(path.resolve(io.cwd, input))
      : undefined;
  if (overlay?.status === "invalid") io.stderr(`warning: ${overlay.warning}\n`);
  const result = await renderBoard(board, {
    direction,
    ...(overlay?.status === "ok" ? { overlay: overlay.overlay } : {}),
    ...(checkRoot !== undefined ? { checkSourcesRoot: path.resolve(io.cwd, checkRoot) } : {}),
    ...(values.references ? { references: { dir: cacheDir } } : {}),
  });
  if (result.references && result.references.frames > result.references.cached) {
    const { frames, cached } = result.references;
    io.stderr(
      `note: ${cached} of ${frames} Figma frame(s) have a cached reference image in ${path.relative(io.cwd, cacheDir) || "."}\n`,
    );
  }
  for (const warning of result.warnings) io.stderr(`warning: ${warning}\n`);
  if (!result.ok || !result.scene) {
    io.stderr(`${input}: ${result.issues.length} issue(s)\n${formatIssues(result.issues)}`);
    return EXIT.invalid;
  }
  const json = `${JSON.stringify(result.scene, null, 2)}\n`;
  const output = values.output ?? defaultOutput(input);
  if (output === "-") {
    io.stdout(json);
    return EXIT.ok;
  }
  try {
    await writeFile(path.resolve(io.cwd, output), json);
  } catch (error) {
    throw new CliError(
      EXIT.io,
      `cannot write ${output}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
  io.stderr(`wrote ${output}\n`);
  return EXIT.ok;
}

/** The overlay beside a board file, `<name>.overlay.json` next to `<name>.board.json`. */
async function overlayBeside(boardFile: string): Promise<OverlayRead> {
  const name = path.basename(boardFile).slice(0, -BOARD_FILE_SUFFIX.length);
  let dir: string;
  try {
    dir = await realpath(path.dirname(boardFile));
  } catch {
    return { status: "none" };
  }
  return readOverlayFile(dir, name);
}
