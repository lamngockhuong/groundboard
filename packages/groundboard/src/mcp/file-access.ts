import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type ExcalidrawScene, SCENE_SOURCE } from "@groundboard/render-excalidraw";
import { BOARD_SLUG } from "../atlas.ts";
import { type OverlayRead, readOverlayFile } from "../overlay-file.ts";

/** Directory under the root that the MCP server may write scenes into. */
export const OUTPUT_DIR = ".groundboard";
const MAX_EXISTING_SCENE_BYTES = 64 * 1024 * 1024;

export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileAccessError";
  }
}

function isInside(child: string, parent: string): boolean {
  return (
    child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
  );
}

export type RootResult = { ok: true; root: string } | { ok: false; reason: string };

/**
 * Resolves the root once at start: `GROUNDBOARD_ROOT`, else the working directory. A filesystem
 * root or the home directory is refused, because confinement to it would confine nothing; the
 * server then runs without file access.
 */
export async function resolveRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = homedir(),
): Promise<RootResult> {
  const requested =
    env.GROUNDBOARD_ROOT && env.GROUNDBOARD_ROOT !== "" ? env.GROUNDBOARD_ROOT : cwd;
  let real: string;
  try {
    real = await realpath(path.resolve(cwd, requested));
    if (!(await stat(real)).isDirectory())
      return { ok: false, reason: `${requested} is not a directory` };
  } catch {
    return { ok: false, reason: `${requested} does not exist` };
  }
  if (real === path.parse(real).root) {
    return {
      ok: false,
      reason: `${real} is a filesystem root; set GROUNDBOARD_ROOT to the project`,
    };
  }
  let realHome: string | undefined;
  try {
    realHome = await realpath(home);
  } catch {
    realHome = undefined;
  }
  if (real === realHome) {
    return {
      ok: false,
      reason: `${real} is the home directory; set GROUNDBOARD_ROOT to the project`,
    };
  }
  return { ok: true, root: real };
}

/**
 * Resolves `requested` (absolute, or relative to the root) to a directory inside the root.
 * `name` is the argument named in error messages.
 */
export async function confineDirectory(
  root: string,
  requested: string,
  name = "checkSourcesRoot",
): Promise<string> {
  let real: string;
  try {
    real = await realpath(path.resolve(root, requested));
  } catch {
    throw new FileAccessError(`${name} does not exist`);
  }
  if (!isInside(real, root)) {
    throw new FileAccessError(`${name} must be the project root or a directory inside it`);
  }
  if (!(await stat(real)).isDirectory()) {
    throw new FileAccessError(`${name} is not a directory`);
  }
  return real;
}

/**
 * `confineDirectory` for the atlas directory a person names on the command line: it also
 * accepts a directory whose path lies inside the root but whose real path does not, because
 * a symlink inside the root points elsewhere (a git worktree whose `.groundboard` links to the
 * main checkout's). The atlas directory only supplies `*.board.json`, overlays and the Figma
 * cache, each read without following a further symlink; the sources boards cite are still
 * checked against the real root. The MCP tools, whose arguments an agent chooses, keep
 * `confineDirectory`. A target that is a filesystem root, the home directory or an ancestor
 * of the root is refused.
 */
export async function confineAtlasDirectory(
  root: string,
  requested: string,
  name: string,
  home = homedir(),
): Promise<string> {
  try {
    return await confineDirectory(root, requested, name);
  } catch (error) {
    const given = path.resolve(root, requested);
    if (!(error instanceof FileAccessError) || !isInside(given, root)) throw error;
    let real: string;
    try {
      real = await realpath(given);
    } catch {
      throw error;
    }
    if (isInside(real, root)) throw error;
    let realHome: string | undefined;
    try {
      realHome = await realpath(home);
    } catch {
      realHome = undefined;
    }
    if (real === path.parse(real).root || real === realHome || isInside(root, real)) {
      throw new FileAccessError(
        `${name} is a symlink to ${real}, which is a filesystem root, the home directory or a parent of the project root; pass --atlas-dir with the real atlas directory and --root with its project`,
      );
    }
    if (!(await stat(real)).isDirectory()) throw new FileAccessError(`${name} is not a directory`);
    return real;
  }
}

async function holdsGroundboardScene(file: string): Promise<boolean> {
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_EXISTING_SCENE_BYTES) return false;
  try {
    const scene = JSON.parse(await readFile(file, "utf8")) as { type?: unknown; source?: unknown };
    return scene.type === "excalidraw" && scene.source === SCENE_SOURCE;
  } catch {
    return false;
  }
}

/**
 * Writes a scene to `outputPath`, which must end in `.excalidraw` and resolve inside
 * `<root>/.groundboard/`. Symlinks are not followed, and an existing file is replaced only
 * when it already holds a groundboard scene. Returns the path relative to the root.
 */
export async function writeSceneConfined(
  root: string,
  outputPath: string,
  scene: ExcalidrawScene,
): Promise<string> {
  if (!outputPath.endsWith(".excalidraw")) {
    throw new FileAccessError("outputPath must end in .excalidraw");
  }
  const outputDir = path.join(root, OUTPUT_DIR);
  const target = path.resolve(root, outputPath);
  if (!isInside(path.dirname(target), outputDir) || target === outputDir) {
    throw new FileAccessError(`outputPath must be inside ${OUTPUT_DIR}/ in the project root`);
  }

  await mkdir(outputDir, { recursive: true });
  // The output directory itself must not be a symlink out of the root.
  if ((await realpath(outputDir)) !== outputDir) {
    throw new FileAccessError(`${OUTPUT_DIR}/ must be a real directory inside the project root`);
  }
  let parent: string;
  try {
    parent = await realpath(path.dirname(target));
  } catch {
    throw new FileAccessError("the directory of outputPath does not exist");
  }
  if (parent !== path.dirname(target) || !isInside(parent, outputDir)) {
    throw new FileAccessError(`outputPath must not pass through a symlink`);
  }

  let exists = true;
  try {
    await lstat(target);
  } catch {
    exists = false;
  }
  if (exists && !(await holdsGroundboardScene(target))) {
    throw new FileAccessError(
      "outputPath names an existing file that groundboard did not write; choose another name",
    );
  }

  // Write a fresh temporary file next to the target, then rename it over the target, so
  // concurrent writers never interleave and a reader never sees half a scene.
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(
    temp,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(`${JSON.stringify(scene, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return path.relative(root, target);
}

/**
 * The layout overlay that belongs with a scene written to `outputPath`: `<name>.overlay.json`
 * beside `<name>.excalidraw`, inside the project's ${OUTPUT_DIR}/ and never through a symlink.
 * None when the path is elsewhere or the file does not exist.
 */
export async function overlayForOutput(root: string, outputPath: string): Promise<OverlayRead> {
  if (!outputPath.endsWith(".excalidraw")) return { status: "none" };
  const target = path.resolve(root, outputPath);
  const slug = path.basename(target).slice(0, -".excalidraw".length);
  if (!BOARD_SLUG.test(slug)) return { status: "none" };
  let realOutputDir: string;
  let realDir: string;
  try {
    realOutputDir = await realpath(path.join(root, OUTPUT_DIR));
    realDir = await realpath(path.dirname(target));
  } catch {
    return { status: "none" };
  }
  if (!isInside(realDir, realOutputDir)) return { status: "none" };
  return readOverlayFile(realDir, slug);
}
