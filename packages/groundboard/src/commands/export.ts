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
      --title <text>       Title of the page (default: the viewer's, "groundboard")
      --previous <file>    The paths the Artifact held after the last publish, one per line
                           (that export's manifest.txt): also write publish-remove.json, the
                           paths to remove as a {"<path>": null} map, and print the order to
                           publish in
      --no-references      Leave the cached Figma images out of the boards
      --skip-cjk-fonts     Leave out the whole Chinese, Japanese and Korean handwriting font
                           (fonts/Xiaolai); text in those scripts then draws with a system
                           font. Without it, only the parts of the font that cover the
                           characters the exported boards use are written.
  -h, --help               Show this help

A board that is stale or invalid, or an atlas with problems, is still exported: the viewer
shows them as \`serve --atlas\` does. Exit codes: 0 written, 1 I/O error, 2 bad arguments.
`;

/** Every file of the export but itself, one path per line; the publish skill reads it. */
export const MANIFEST_FILE = "manifest.txt";
/**
 * Prefix of the batch files: `<prefix>-<n>.json` lists, as `[{"path": ...}]`, the files one
 * Artifact publish sends, every manifest path but `index.html` (the page is sent apart).
 */
export const PUBLISH_BATCH_PREFIX = "publish-batch";
/**
 * Written only with `--previous`: a `{"<path>": null}` map of the previously published paths
 * this export no longer has, ready to pass as an Artifact publish's `files` to remove them.
 */
export const PUBLISH_REMOVE_FILE = "publish-remove.json";
/** Meta tag that tells the viewer to read `data/` instead of the API. */
export const STATIC_MODE_META = '<meta name="groundboard:mode" content="static" />';
/** Largest data file the export writes; a Claude Artifact takes text files up to 16 MB. */
export const MAX_EXPORT_FILE_BYTES = 15 * 1024 * 1024;
/**
 * What one Artifact publish sends beside its page, and what one Artifact version holds. A
 * publish takes at most 255 `files` and 64 MB; a batch stays at 250 files and 60 MB, so the
 * page sent with it, and a skill that miscounts by a few, still fit.
 */
export const ARTIFACT_LIMITS = {
  filesPerPublish: 250,
  bytesPerPublish: 60 * 1024 * 1024,
  files: 511,
  bytes: 256 * 1024 * 1024,
} as const;
/** Font directory of the viewer build only text in Chinese, Japanese or Korean needs. */
const CJK_FONT_DIR = path.join("fonts", "Xiaolai");
/** The viewer build's map of each CJK font file to its `unicode-range`; never exported. */
const CJK_RANGES_FILE = path.join("fonts", "xiaolai-ranges.json");

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
 * `null` and the real state in a repository with no commit yet. Changes under `ignore` (paths
 * inside the root, such as the atlas directory, whose boards are not the sources they cite)
 * do not count; a symlink there is ignored as the entry it is, wherever it points.
 */
export async function gitState(
  root: string,
  ignore: string[] = [],
): Promise<{ commit: string | null; dirty: boolean }> {
  const excluded = ignore
    .map((entry) => path.relative(root, entry))
    .filter(
      (rel) =>
        rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel),
    )
    .map((rel) => `:(exclude,literal)${rel.split(path.sep).join("/")}`);
  let dirty: boolean;
  try {
    const status = await run("git", ["status", "--porcelain", "--", ".", ...excluded], {
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
  /** Replaces the page's `<title>`. */
  title?: string;
  /** Board JSON larger than this is rendered again without Figma images. */
  maxFileBytes?: number;
  /**
   * The atlas directory as named inside the root (a symlink unresolved); its changes are not
   * counted as uncommitted. Defaults to `dir`.
   */
  atlasEntry?: string;
  /** Paths the Artifact held after the last publish, one per manifest line; see `--previous`. */
  previous?: string[];
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
  /** CJK font files written, of those the viewer has. */
  cjkFonts: { written: number; total: number };
  /** Batch files written for the Artifact publish, in order. */
  batches: string[];
  /** With `previous`: what an update has to remove, and in which order to publish. */
  removal?: PublishRemoval;
  stamp: ExportStamp;
}

/** How an update of a published Artifact removes the paths the export no longer has. */
export interface PublishRemoval {
  /** Previously published paths beside the page. */
  previous: number;
  /** Previously published paths this export no longer has, written to `PUBLISH_REMOVE_FILE`. */
  stale: string[];
  /** Paths of the first batch not published before. */
  newInFirstBatch: number;
  /**
   * The version would pass `ARTIFACT_LIMITS.files` with the first batch added to what it
   * holds, so the removals go first.
   */
  removeFirst: boolean;
}

/**
 * What an update removes: every previously published path but the page that the export does
 * not have, and whether the first batch fits beside what the version already holds.
 */
export function publishRemoval(
  previous: string[],
  manifest: string[],
  firstBatch: string[],
): PublishRemoval {
  const before = new Set(previous.filter((p) => p !== "index.html"));
  const now = new Set(manifest);
  const stale = [...before].filter((p) => !now.has(p));
  const newInFirstBatch = firstBatch.filter((p) => !before.has(p)).length;
  return {
    previous: before.size,
    stale,
    newInFirstBatch,
    removeFirst: before.size + newInFirstBatch > ARTIFACT_LIMITS.files,
  };
}

/** The lines of a `--previous` file: trimmed, blank lines and repeats dropped. */
export function parsePrevious(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
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

/** Parses a CSS `unicode-range` such as `U+20-7e,U+3000` into inclusive code point ranges. */
export function parseUnicodeRange(range: string): [number, number][] {
  return range.split(",").flatMap((part) => {
    const m = /^\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) return [];
    const from = Number.parseInt(m[1] as string, 16);
    return [[from, m[2] === undefined ? from : Number.parseInt(m[2], 16)]];
  });
}

/** Every code point above ASCII that occurs in `texts`. */
export function nonAsciiCodePoints(texts: Iterable<string>): Set<number> {
  const found = new Set<number>();
  for (const text of texts) {
    for (const [ch] of text.matchAll(/[^\0-\x7f]/gu)) found.add(ch.codePointAt(0) as number);
  }
  return found;
}

/**
 * Which CJK font files to export: none when skipped; else those whose `unicode-range` covers
 * a code point the export's text uses. The browser fetches a file only for text in its range,
 * so the others are never asked for. Without the viewer's range map, or for a file missing from
 * it, the file is kept.
 */
async function cjkFontFilter(
  webRoot: string,
  skip: boolean,
  used: Set<number>,
): Promise<(rel: string) => boolean> {
  if (skip) return () => false;
  let map: Record<string, string>;
  try {
    map = JSON.parse(await readFile(path.join(webRoot, CJK_RANGES_FILE), "utf8"));
  } catch {
    return () => true;
  }
  const points = [...used];
  return (rel) => {
    const range = map[path.basename(rel)];
    if (typeof range !== "string") return true;
    return parseUnicodeRange(range).some(([from, to]) =>
      points.some((point) => point >= from && point <= to),
    );
  };
}

/** Files of the built viewer, relative paths, without index.html and its range map. */
async function viewerFiles(webRoot: string): Promise<string[]> {
  const entries = await readdir(webRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(webRoot, path.join(e.parentPath, e.name)))
    .filter((rel) => rel !== "index.html" && rel !== CJK_RANGES_FILE)
    .sort();
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The viewer page with the static-mode flag at the top of its head, and `title` if given. */
export function staticIndexHtml(html: string, title?: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new CliError(EXIT.io, "the viewer's index.html has no <head>");
  const at = head.index + head[0].length;
  let page = `${html.slice(0, at)}\n    ${STATIC_MODE_META}${html.slice(at)}`;
  if (title !== undefined) {
    const element = `<title>${escapeHtml(title)}</title>`;
    page = /<title[^>]*>[\s\S]*?<\/title>/i.test(page)
      ? page.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => element)
      : page.replace(STATIC_MODE_META, () => `${STATIC_MODE_META}\n    ${element}`);
  }
  return page;
}

/**
 * Splits the files one Artifact publishes beside its page into batches of at most
 * `ARTIFACT_LIMITS.filesPerPublish` files and `bytesPerPublish` bytes, in manifest order.
 */
export function publishBatches(files: { path: string; bytes: number }[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const file of files) {
    if (
      current.length > 0 &&
      (current.length >= ARTIFACT_LIMITS.filesPerPublish ||
        bytes + file.bytes > ARTIFACT_LIMITS.bytesPerPublish)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file.path);
    bytes += file.bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
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
  const stamp: ExportStamp = {
    checkedAt,
    ...(await gitState(options.root, [options.atlasEntry ?? options.dir])),
    version: VERSION,
  };

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
  const html = staticIndexHtml(
    await readFile(path.join(webRoot, "index.html"), "utf8"),
    options.title,
  );
  // Board titles, node text and notes all sit in the JSON written below; what else it holds
  // (code excerpts, the board files) can only add a font file, never drop one that is needed.
  const keepCjk = await cjkFontFilter(
    webRoot,
    options.skipCjkFonts ?? false,
    nonAsciiCodePoints([atlasText, ...boards.values()]),
  );
  const allFiles = await viewerFiles(webRoot);
  const cjkTotal = allFiles.filter((rel) => isInside(rel, CJK_FONT_DIR)).length;
  const files = allFiles.filter((rel) => !isInside(rel, CJK_FONT_DIR) || keepCjk(rel));
  const cjkWritten = files.filter((rel) => isInside(rel, CJK_FONT_DIR)).length;

  let bytes = 0;
  const written: string[] = [];
  const sizes = new Map<string, number>();
  const record = (rel: string, size: number) => {
    bytes += size;
    written.push(rel);
    sizes.set(rel, size);
  };
  const write = async (rel: string, data: string) => {
    const target = path.join(out, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    record(rel, Buffer.byteLength(data));
  };
  const posix = (rel: string) => rel.split(path.sep).join("/");
  const batchNames: string[] = [];
  let removal: PublishRemoval | undefined;
  const existed = existsSync(out);
  try {
    await mkdir(out, { recursive: true });
    await write("index.html", html);
    for (const rel of files) {
      const target = path.join(out, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(webRoot, rel), target);
      record(rel, (await stat(target)).size);
    }
    await write(path.join("data", "atlas.json"), atlasText);
    for (const [slug, text] of boards)
      await write(path.join("data", "boards", `${slug}.json`), text);
    const manifest = `${written.map(posix).join("\n")}\n`;
    const batches = publishBatches(
      written
        .filter((rel) => rel !== "index.html")
        .map((rel) => ({ path: posix(rel), bytes: sizes.get(rel) ?? 0 })),
    );
    await write(MANIFEST_FILE, manifest);
    // Ready to pass as an Artifact publish's `files`; not in the manifest, never published.
    for (const [i, batch] of batches.entries()) {
      const name = `${PUBLISH_BATCH_PREFIX}-${i + 1}.json`;
      const list = batch.map((p) => `  ${JSON.stringify({ path: p })}`).join(",\n");
      await writeFile(path.join(out, name), `[\n${list}\n]\n`);
      batchNames.push(name);
    }
    if (options.previous !== undefined) {
      removal = publishRemoval(options.previous, written.map(posix), batches[0] ?? []);
      const lines = removal.stale.map((p) => `  ${JSON.stringify(p)}: null`).join(",\n");
      await writeFile(
        path.join(out, PUBLISH_REMOVE_FILE),
        removal.stale.length === 0 ? "{}\n" : `{\n${lines}\n}\n`,
      );
    }
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
    cjkFonts: { written: cjkWritten, total: cjkTotal },
    batches: batchNames,
    ...(removal !== undefined ? { removal } : {}),
    stamp,
  };
}

/** What `export --previous` prints: the paths to remove and the order to publish in. */
function removalLines(removal: PublishRemoval, batches: string[]): string {
  const [first, ...rest] = batches;
  const order =
    removal.stale.length === 0
      ? batches
      : removal.removeFirst
        ? [PUBLISH_REMOVE_FILE, ...batches]
        : [first ?? "", PUBLISH_REMOVE_FILE, ...rest];
  return (
    `previously published: ${removal.previous} file(s) beside the page; ${removal.stale.length} no longer exported, listed in ${PUBLISH_REMOVE_FILE}; ${removal.newInFirstBatch} of ${first} not published before\n` +
    `publish order: ${order.filter((name) => name !== "").join(", ")}` +
    (removal.removeFirst
      ? ` (removals first: ${removal.previous} + ${removal.newInFirstBatch} would pass ${ARTIFACT_LIMITS.files} files)`
      : "") +
    "\n"
  );
}

export async function exportCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      root: { type: "string" },
      "atlas-dir": { type: "string" },
      title: { type: "string" },
      references: { type: "boolean", default: true },
      "skip-cjk-fonts": { type: "boolean" },
      previous: { type: "string" },
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
  const { root, dir, entry } = await resolveAtlasPaths(
    io.cwd,
    values.root,
    values["atlas-dir"],
    "--atlas-dir",
  );
  const out = path.resolve(io.cwd, values.out);
  let previous: string[] | undefined;
  if (values.previous !== undefined) {
    if (values.previous === "") throw new CliError(EXIT.usage, "--previous needs a file");
    try {
      previous = parsePrevious(await readFile(path.resolve(io.cwd, values.previous), "utf8"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      throw new CliError(EXIT.io, `cannot read --previous: ${code}`);
    }
  }
  const summary = await exportAtlas(
    {
      dir,
      root,
      atlasEntry: entry,
      out,
      ...(previous !== undefined ? { previous } : {}),
      references: values.references,
      skipCjkFonts: values["skip-cjk-fonts"] ?? false,
      ...(values.title !== undefined ? { title: values.title } : {}),
    },
    io.stderr,
  );

  const { stamp } = summary;
  if (summary.stale + summary.invalid + summary.problems > 0) {
    io.stderr(
      `warning: the atlas has ${summary.stale} stale and ${summary.invalid} invalid board(s) and ${summary.problems} problem(s); the pages show them. Run "groundboard atlas check" for details.\n`,
    );
  }
  // The manifest is not published and the page replaces index.html: published = files - 1.
  const published = summary.files - 1;
  const { cjkFonts } = summary;
  if (published > ARTIFACT_LIMITS.files || summary.bytes > ARTIFACT_LIMITS.bytes) {
    const tooMany = published > ARTIFACT_LIMITS.files;
    io.stderr(
      `warning: ${published} files and ${megabytes(summary.bytes)} do not fit one Claude Artifact (at most ${ARTIFACT_LIMITS.files} files and ${megabytes(ARTIFACT_LIMITS.bytes)}); ` +
        (tooMany && cjkFonts.written > 0
          ? `--skip-cjk-fonts leaves out ${cjkFonts.written} file(s), `
          : "") +
        (summary.bytes > ARTIFACT_LIMITS.bytes
          ? "--no-references makes the boards smaller, "
          : "") +
        "and any other static host still serves them\n",
    );
  }
  io.stdout(
    `exported ${summary.boards} board(s) to ${out}: ${published} files to publish, ${megabytes(summary.bytes)}\n` +
      (cjkFonts.total === 0
        ? ""
        : values["skip-cjk-fonts"]
          ? "CJK handwriting font: left out (--skip-cjk-fonts); Chinese, Japanese and Korean text draws with a system font\n"
          : `CJK handwriting font: ${cjkFonts.written} of ${cjkFonts.total} file(s), for the characters the boards use\n`) +
      `Artifact publish batches (at most ${ARTIFACT_LIMITS.filesPerPublish} files and ${megabytes(ARTIFACT_LIMITS.bytesPerPublish)} each): ${summary.batches.join(", ")}\n` +
      (summary.removal === undefined ? "" : removalLines(summary.removal, summary.batches)) +
      `sources checked ${stamp.checkedAt}${stamp.commit ? ` at commit ${stamp.commit}${stamp.dirty ? " with uncommitted changes" : ""}` : " (not a git repository)"}\n`,
  );
  return EXIT.ok;
}
