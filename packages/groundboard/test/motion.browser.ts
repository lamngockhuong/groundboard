// Motion in the built viewer: the arrows of the selected node run over the canvas, and a
// presentation reveals the board step by step, then leaves the scene exactly as it was, with
// nothing added to undo. Checked on `groundboard serve` and on a static `groundboard export`,
// with and without reduced motion. Needs `pnpm -r build` and
// `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exportAtlas } from "../src/commands/export.ts";
import { createApp } from "../src/server/app.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));
const atlasDir = path.join(fixtures, ".groundboard");

/*
 * place-order: press → terms → {refuse, post}; refuse → error-ui; post → home. Selecting
 * `terms` runs its three arrows (e1 in, e2 and e3 out) and lights the four nodes at their ends.
 * The presentation walks it in four levels.
 */
const SLUG = "place-order";
const SELECTED = "terms";
const RUNNING_ARROWS = 3;
const LIT_NODES = 4;
const STEPS = 4;

interface Running {
  origin: string;
  close: () => Promise<void>;
}

async function startServe(): Promise<Running> {
  const built = createApp({ host: "127.0.0.1", webRoot, atlas: { dir: atlasDir, root: fixtures } });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: built.app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await built.close();
    },
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The exported folder served as plain files, the way an Artifact host serves it. */
async function startStatic(dir: string): Promise<Running> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let browser: Browser;
let exported: string;

beforeAll(async () => {
  if (!existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`${webRoot} is missing; run "pnpm -r build" first`);
  }
  exported = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-motion-")));
  await exportAtlas({ dir: atlasDir, root: fixtures, out: exported, webRoot }, () => {});
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  if (exported) rmSync(exported, { recursive: true, force: true });
});

async function waitForBoard(page: Page): Promise<void> {
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

/** The elements of the scene on the canvas, as the viewer's ".excalidraw" export saves them. */
async function sceneElements(page: Page): Promise<unknown[]> {
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /\.excalidraw/ }).click(),
  ]);
  const file = await download.path();
  return JSON.parse(readFileSync(file, "utf8")).elements;
}

/** Animations running inside the motion overlay. */
const overlayAnimations = (page: Page): Promise<number> =>
  // A string, run in the page: this package is typed without the DOM.
  page.evaluate(
    `document.getAnimations().filter((a) => a.effect?.target?.closest?.(".motion-overlay")).length`,
  );

interface Seen {
  flows: number;
  glows: number;
  animations: number;
  counters: string[];
  drawnDuringStep: number;
  undoChanged: boolean;
  restored: boolean;
  external: string[];
  errors: string[];
}

async function walk(origin: string, reducedMotion: "reduce" | "no-preference"): Promise<Seen> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion,
    acceptDownloads: true,
  });
  const external: string[] = [];
  const errors: string[] = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || /^(data|blob):/.test(url)) return route.continue();
    external.push(url);
    return route.abort("blockedbyclient");
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
    await page.goto(`${origin}/#/board/${SLUG}?node=${SELECTED}`);
    await waitForBoard(page);

    // A straight arrow is a path with no height, which Playwright calls hidden.
    await page
      .locator(".motion-overlay .motion-flow")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 });
    const flows = await page.locator(".motion-overlay .motion-flow").count();
    const glows = await page.locator(".motion-overlay .motion-glow").count();
    const animations = await overlayAnimations(page);

    const before = await sceneElements(page);
    await page.getByRole("button", { name: "Present", exact: true }).click();
    const counter = page.locator(".present-counter");
    const counters = [(await counter.textContent()) ?? ""];
    let drawnDuringStep = 0;
    for (let i = 1; i < STEPS; i++) {
      await page.keyboard.press("ArrowRight");
      if (reducedMotion === "no-preference") {
        // The camera moves first, then the step's arrows draw in.
        await page.waitForTimeout(650);
        drawnDuringStep += await page.locator(".motion-overlay .motion-draw").count();
      }
      await page.waitForTimeout(reducedMotion === "reduce" ? 200 : 1200);
      counters.push((await counter.textContent()) ?? "");
    }
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape");
    await page.locator(".present-controls").waitFor({ state: "hidden" });
    await page.waitForTimeout(300);
    const after = await sceneElements(page);
    // Undo right after leaving changes nothing: the presentation left no step behind.
    await page
      .locator(".canvas canvas")
      .last()
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    const afterUndo = await sceneElements(page);

    return {
      flows,
      glows,
      animations,
      counters,
      drawnDuringStep,
      restored: JSON.stringify(after) === JSON.stringify(before),
      undoChanged: JSON.stringify(afterUndo) !== JSON.stringify(after),
      external,
      errors,
    };
  } finally {
    await context.close();
  }
}

const counters = Array.from({ length: STEPS }, (_, i) => `Step ${i + 1} of ${STEPS}`);

describe("motion on the canvas", () => {
  test("runs around the selection and presents a board on groundboard serve", async () => {
    const server = await startServe();
    try {
      const seen = await walk(server.origin, "no-preference");
      expect(seen).toMatchObject({
        flows: RUNNING_ARROWS,
        glows: LIT_NODES,
        counters,
        restored: true,
        undoChanged: false,
        external: [],
        errors: [],
      });
      expect(seen.animations).toBeGreaterThanOrEqual(RUNNING_ARROWS);
      expect(seen.drawnDuringStep).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  test("moves nothing with reduced motion, on a static export", async () => {
    const server = await startStatic(exported);
    try {
      const seen = await walk(server.origin, "reduce");
      expect(seen).toMatchObject({
        flows: RUNNING_ARROWS,
        glows: LIT_NODES,
        animations: 0,
        counters,
        drawnDuringStep: 0,
        restored: true,
        undoChanged: false,
        external: [],
        errors: [],
      });
    } finally {
      await server.close();
    }
  });
});
