import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { type AtlasIndex, atlasIdOf, buildAtlas } from "../atlas.ts";
import { type AtlasBoardOptions, renderAtlasBoard } from "../atlas-board.ts";
import { isInside } from "../fs-confined.ts";
import { OUTPUT_DIR } from "../mcp/file-access.ts";
import { publicAtlas } from "../server/app.ts";
import { VERSION } from "../version.ts";
import { resolveAtlasPaths } from "./atlas.ts";
import { CliError, type CliIO, EXIT } from "./io.ts";

export const exportHelp = `Usage: groundboard export --out <dir> [options]

Write the screen atlas as a static site: the built viewer, the atlas index and every board
rendered to JSON, the way \`serve --atlas\` serves them. Each board's JSON also carries its
board file and its layout overlay as written, so a reader can download the boards as a zip. Any static host can serve the result,
and \`/groundboard:publish\` posts it as a Claude Artifact. The pages are a snapshot: they say
when the sources were checked and at which commit.

Options:
      --out <dir>          Directory to write; must be empty or not exist, and must neither be
                           inside the atlas directory nor contain it
      --root <path>        Project root sources are checked against (default .)
      --atlas-dir <path>   Directory of *.board.json inside the root (default <root>/${OUTPUT_DIR})
      --no-references      Leave the cached Figma images out of the boards
      --skip-cjk-fonts     Leave out the Chinese, Japanese and Korean handwriting font
                           (fonts/Xiaolai, about half the files); boards in those scripts
                           then draw with a fallback font
  -h, --help               Show this help

A board that is stale or invalid, or an atlas with problems, is still exported: the viewer
shows them as \`serve --atlas\` does. Exit codes: 0 written, 1 I/O error, 2 bad arguments.
`;

/** Every file of the export but itself, one path per line; the publish skill reads it. */
export const MANIFEST_FILE = "manifest.txt";
/** Meta tag that tells the viewer to read `data/` instead of the API. */
export const STATIC_MODE_META = '<meta name="groundboard:mode" content="static" />';
/** Largest data file the export writes; a Claude Artifact takes text files up to 16 MB. */
export const MAX_EXPORT_FILE_BYTES = 15 * 1024 * 1024;
/** Files one Artifact publish sends, and files and bytes one Artifact version holds. */
export const ARTIFACT_LIMITS = {
  filesPerPublish: 255,
  files: 511,
  bytes: 256 * 1024 * 1024,
} as const;
/** Font directory of the viewer build only boards in Chinese, Japanese or Korean need. */
const CJK_FONT_DIR = path.join("fonts", "Xiaolai");

const defaultWebRoot = () => fileURLToPath(new URL("./web", import.meta.url));
const run = promisify(execFile);

/** When the export checked the sources, and against which commit of the root. */
export interface ExportStamp {
  checkedAt: string;
  commit: string | null;
  dirty: boolean;
  version: string;
}

/**
 * The commit of `root` and whether it has uncommitted changes: `null` and false outside git,
 * `null` and the real state in a repository with no commit yet.
 */
export async function gitState(root: string): Promise<{ commit: string | null; dirty: boolean }> {
  let dirty: boolean;
  try {
    const status = await run("git", ["status", "--porcelain", "--", "."], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    });
    dirty = status.stdout.trim() !== "";
  } catch {
    return { commit: null, dirty: false };
  }
  try {
    const head = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
    return { commit: head.stdout.trim() || null, dirty };
  } catch {
    return { commit: null, dirty };
  }
}

export interface ExportOptions {
  dir: string;
  root: string;
  out: string;
  /** The built viewer; defaults to `web/` next to this module. */
  webRoot?: string;
  references?: boolean;
  skipCjkFonts?: boolean;
  /** Board JSON larger than this is rendered again without Figma images. */
  maxFileBytes?: number;
  /** Size caps of the Figma images, for tests. */
  referenceLimits?: { maxImageBytes?: number; maxBoardBytes?: number };
  now?: () => Date;
}

export interface ExportSummary {
  files: number;
  bytes: number;
  boards: number;
  stale: number;
  invalid: number;
  problems: number;
  /** Boards written without their Figma images because they were too large with them. */
  withoutReferences: string[];
  stamp: ExportStamp;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The real path of `target`, resolving the deepest part of it that exists. */
async function realTarget(target: string): Promise<string> {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** Refuses an output directory that holds files or overlaps the atlas directory. */
async function checkOut(out: string, dir: string): Promise<string> {
  const real = await realTarget(out);
  if (isInside(real, dir) || isInside(dir, real)) {
    throw new CliError(
      EXIT.usage,
      "--out must neither be inside the atlas directory nor contain it",
    );
  }
  let entries: string[];
  try {
    if (!(await stat(real)).isDirectory()) {
      throw new CliError(EXIT.usage, "--out exists and is not a directory");
    }
    entries = await readdir(real);
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return real;
    throw error;
  }
  if (entries.length > 0) throw new CliError(EXIT.usage, "--out must be empty or not exist");
  return real;
}

/** Files of the built viewer, relative paths, without index.html and the skipped fonts. */
async function viewerFiles(webRoot: string, skipCjkFonts: boolean): Promise<string[]> {
  const entries = await readdir(webRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(webRoot, path.join(e.parentPath, e.name)))
    .filter((rel) => rel !== "index.html")
    .filter((rel) => !(skipCjkFonts && isInside(rel, CJK_FONT_DIR)))
    .sort();
}

/** The viewer page with the static-mode flag at the top of its head. */
export function staticIndexHtml(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new CliError(EXIT.io, "the viewer's index.html has no <head>");
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}\n    ${STATIC_MODE_META}${html.slice(at)}`;
}

/**
 * Writes the static export. Every board is rendered before anything is written, so a board
 * that cannot fit leaves `out` untouched; a failed write removes what was written.
 */
export async function exportAtlas(
  options: ExportOptions,
  warn: (text: string) => void,
): Promise<ExportSummary> {
  const out = await checkOut(options.out, options.dir);
  const webRoot = options.webRoot ?? defaultWebRoot();
  if (!existsSync(path.join(webRoot, "index.html"))) {
    throw new CliError(
      EXIT.io,
      `the viewer is not built (${webRoot} has no index.html); run "pnpm -r build" first`,
    );
  }
  const maxFileBytes = options.maxFileBytes ?? MAX_EXPORT_FILE_BYTES;
  const withReferences = options.references ?? true;

  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  let atlas: AtlasIndex;
  try {
    atlas = await buildAtlas(options.dir, options.root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    throw new CliError(EXIT.io, `cannot read the atlas directory: ${code}`);
  }
  const stamp: ExportStamp = { checkedAt, ...(await gitState(options.root)), version: VERSION };

  const boards = new Map<string, string>();
  const withoutReferences: string[] = [];
  for (const { slug } of atlas.boards) {
    const render = (references: AtlasBoardOptions["references"]) =>
      renderAtlasBoard(options.dir, options.root, slug, { references });
    let response = await render(withReferences ? (options.referenceLimits ?? true) : false);
    if (response.status === 404) {
      warn(`warning: ${slug}.board.json disappeared while exporting; skipped\n`);
      continue;
    }
    // The board file itself rides along, so the viewer can hand it back in a zip.
    const withSource = (r: typeof response) =>
      JSON.stringify(
        r.status === 404
          ? r.body
          : {
              ...r.body,
              source: r.source,
              ...(r.overlay !== undefined ? { overlay: r.overlay } : {}),
            },
      );
    let text = withSource(response);
    if (Buffer.byteLength(text) > maxFileBytes && withReferences) {
      response = await render(false);
      text = withSource(response);
      withoutReferences.push(slug);
      warn(
        `warning: ${slug} is larger than ${megabytes(maxFileBytes)} with its Figma images; exported without them\n`,
      );
    }
    if (Buffer.byteLength(text) > maxFileBytes) {
      throw new CliError(
        EXIT.io,
        `${slug} renders to ${megabytes(Buffer.byteLength(text))}, more than ${megabytes(maxFileBytes)}; nothing was written`,
      );
    }
    boards.set(slug, text);
  }

  // A board that vanished while exporting is left out of the index too, so no link is dead.
  const index = publicAtlas(atlas);
  const atlasText = JSON.stringify({
    ...index,
    boards: index.boards.filter((b) => boards.has(b.slug)),
    atlasId: atlasIdOf(await realpath(options.root)),
    exported: stamp,
  });
  const html = staticIndexHtml(await readFile(path.join(webRoot, "index.html"), "utf8"));
  const files = await viewerFiles(webRoot, options.skipCjkFonts ?? false);

  let bytes = 0;
  const written: string[] = [];
  const write = async (rel: string, data: string) => {
    const target = path.join(out, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    bytes += Buffer.byteLength(data);
    written.push(rel);
  };
  const existed = existsSync(out);
  try {
    await mkdir(out, { recursive: true });
    await write("index.html", html);
    for (const rel of files) {
      const target = path.join(out, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(webRoot, rel), target);
      bytes += (await stat(target)).size;
      written.push(rel);
    }
    await write(path.join("data", "atlas.json"), atlasText);
    for (const [slug, text] of boards)
      await write(path.join("data", "boards", `${slug}.json`), text);
    const manifest = `${written.map((rel) => rel.split(path.sep).join("/")).join("\n")}\n`;
    await write(MANIFEST_FILE, manifest);
  } catch (error) {
    // `out` was empty or missing: put it back that way, so the next run is not refused.
    await rm(out, { recursive: true, force: true }).catch(() => {});
    if (existed) await mkdir(out, { recursive: true }).catch(() => {});
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    throw new CliError(EXIT.io, `cannot write the export: ${code}`);
  }

  return {
    files: written.length,
    bytes,
    boards: boards.size,
    stale: atlas.boards.filter((b) => b.status === "stale").length,
    invalid: atlas.boards.filter((b) => b.status === "invalid").length,
    problems: atlas.problems.length,
    withoutReferences,
    stamp,
  };
}

export async function exportCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      root: { type: "string" },
      "atlas-dir": { type: "string" },
      references: { type: "boolean", default: true },
      "skip-cjk-fonts": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowNegative: true,
    allowPositionals: true,
  });
  if (values.help) {
    io.stdout(exportHelp);
    return EXIT.ok;
  }
  if (positionals.length > 0) {
    throw new CliError(EXIT.usage, `unexpected argument ${JSON.stringify(positionals[0])}`);
  }
  if (values.out === undefined || values.out === "") {
    throw new CliError(EXIT.usage, `--out is required\n\n${exportHelp}`);
  }
  const { root, dir } = await resolveAtlasPaths(
    io.cwd,
    values.root,
    values["atlas-dir"],
    "--atlas-dir",
  );
  const out = path.resolve(io.cwd, values.out);
  const summary = await exportAtlas(
    {
      dir,
      root,
      out,
      references: values.references,
      skipCjkFonts: values["skip-cjk-fonts"] ?? false,
    },
    io.stderr,
  );

  const { stamp } = summary;
  if (summary.stale + summary.invalid + summary.problems > 0) {
    io.stderr(
      `warning: the atlas has ${summary.stale} stale and ${summary.invalid} invalid board(s) and ${summary.problems} problem(s); the pages show them. Run "groundboard atlas check" for details.\n`,
    );
  }
  if (summary.files > ARTIFACT_LIMITS.files || summary.bytes > ARTIFACT_LIMITS.bytes) {
    io.stderr(
      `warning: ${summary.files} files and ${megabytes(summary.bytes)} do not fit one Claude Artifact (at most ${ARTIFACT_LIMITS.files} files and ${megabytes(ARTIFACT_LIMITS.bytes)}); any other static host still serves them\n`,
    );
  } else if (summary.files > ARTIFACT_LIMITS.filesPerPublish) {
    io.stderr(
      `note: ${summary.files} files need more than one Artifact publish (at most ${ARTIFACT_LIMITS.filesPerPublish} files each)\n`,
    );
  }
  io.stdout(
    `exported ${summary.boards} board(s) to ${out}: ${summary.files} files, ${megabytes(summary.bytes)}\n` +
      `sources checked ${stamp.checkedAt}${stamp.commit ? ` at commit ${stamp.commit}${stamp.dirty ? " with uncommitted changes" : ""}` : " (not a git repository)"}\n`,
  );
  return EXIT.ok;
}
