// Tabs of the built viewer: an ordinary click replaces the preview tab, Alt and a click or the
// row's button opens a new one, each tab keeps the view it was left at, a reload brings the
// tabs back, and an atlas of one board has no tab bar. On a served atlas, on an exported page
// inside an iframe, and in the list of boards kept in the browser. Needs `pnpm -r build` and
// `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type Browser, chromium, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exportAtlas } from "../src/commands/export.ts";
import { type AppOptions, createApp } from "../src/server/app.ts";
import { openExampleBoards } from "./library-boards.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));
const atlasDir = path.join(fixtures, ".groundboard");

async function listen(fetch: (request: Request) => Response | Promise<Response>) {
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function start(options: AppOptions) {
  const built = createApp({ host: "127.0.0.1", webRoot, ...options });
  const running = await listen(built.app.fetch);
  return {
    origin: running.origin,
    close: async () => {
      await running.close();
      await built.close();
    },
  };
}

let browser: Browser;
beforeAll(async () => {
  if (!existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`${webRoot} is missing; run "pnpm -r build" first`);
  }
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

type Viewer = Page | Frame;

async function waitForBoard(viewer: Viewer): Promise<void> {
  await viewer.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await viewer.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await viewer.waitForTimeout(600);
}

const tabTitles = (viewer: Viewer) => viewer.locator('[role="tab"] .tab-title').allTextContents();
const selectedTab = (viewer: Viewer) =>
  viewer.locator('[role="tab"][aria-selected="true"] .tab-title').textContent();
const boardTitle = (viewer: Viewer) => viewer.locator(".board-title-text").textContent();
const sidebarLink = (viewer: Viewer, title: string) =>
  viewer.locator(".sidebar .nav-group a.nav-item", { hasText: title }).first();

/** Excalidraw's own state: where the canvas stands. Read from its React component. */
async function canvasView(viewer: Viewer) {
  return viewer.evaluate(`(() => {
    const el = document.querySelector(".excalidraw");
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let fiber = key ? el[key] : null;
    while (fiber) {
      const state = fiber.stateNode && fiber.stateNode.state;
      if (state && "scrollX" in state && "zoom" in state) {
        return {
          scrollX: Math.round(state.scrollX),
          scrollY: Math.round(state.scrollY),
          zoom: Math.round(state.zoom.value * 1000) / 1000,
        };
      }
      fiber = fiber.return;
    }
    return null;
  })()`);
}

/** Zooms in and pans, so the view is not the one a board opens at. */
async function moveCanvas(page: Page, viewer: Viewer): Promise<void> {
  const box = await viewer.locator(".canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.mouse.wheel(120, 80);
  await page.waitForTimeout(400);
}

/** The steps every source shares, with a board to compare views on. */
async function exercise(page: Page, viewer: Viewer, titles: string[]): Promise<void> {
  const [first, second, third] = titles as [string, string, string];
  // Ordinary clicks: one preview tab, whose board changes.
  for (const title of titles) {
    await sidebarLink(viewer, title).click();
    await waitForBoard(viewer);
  }
  expect(await tabTitles(viewer)).toEqual([third]);
  expect(await viewer.locator(".tab.preview").count()).toBe(1);

  // Alt and a click: a new tab, pinned.
  await sidebarLink(viewer, first).click({ modifiers: ["Alt"] });
  await waitForBoard(viewer);
  expect(await tabTitles(viewer)).toEqual([third, first]);
  expect(await selectedTab(viewer)).toBe(first);
  expect(await viewer.locator(".tab.preview").count()).toBe(1);

  // The row's "open in a new tab" button.
  await sidebarLink(viewer, second).hover();
  await viewer
    .locator(".sidebar li", { hasText: second })
    .first()
    .getByRole("button", { name: `Open ${second} in a new tab` })
    .click();
  await waitForBoard(viewer);
  expect(await tabTitles(viewer)).toEqual([third, first, second]);

  // Alt 1 and Alt 2 go back and forth; each tab keeps its view.
  await moveCanvas(page, viewer);
  const kept = await canvasView(viewer);
  await page.keyboard.press("Alt+1");
  await waitForBoard(viewer);
  expect(await boardTitle(viewer)).toBe(third);
  await page.keyboard.press("Alt+9");
  await waitForBoard(viewer);
  expect(await boardTitle(viewer)).toBe(second);
  expect(await canvasView(viewer)).toEqual(kept);

  // Alt W closes the tab on screen; the one to its left takes the screen.
  await page.keyboard.press("Alt+w");
  await waitForBoard(viewer);
  expect(await tabTitles(viewer)).toEqual([third, first]);
  expect(await selectedTab(viewer)).toBe(first);

  // The atlas home closes no tab, and choosing a tab brings its board back.
  await viewer.locator(".sidebar a.nav-home").click();
  await viewer.locator(".atlas-home").waitFor();
  expect(await tabTitles(viewer)).toEqual([third, first]);
  expect(await viewer.locator('[role="tab"][aria-selected="true"]').count()).toBe(0);
  await viewer.getByRole("tab", { name: third }).click();
  await waitForBoard(viewer);
  expect(await boardTitle(viewer)).toBe(third);
}

describe("tabs", () => {
  test("on a served atlas", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/`);
      await page.locator(".atlas-home").waitFor({ timeout: 30_000 });
      await exercise(page, page, ["Checkout screen", "Orders API", "Shop database"]);

      // Ctrl and a click is the browser's: a page of its own, no new tab in the viewer.
      const before = await tabTitles(page);
      const [popup] = await Promise.all([
        context.waitForEvent("page"),
        sidebarLink(page, "Cart").click({ modifiers: ["Control"] }),
      ]);
      // Its board loaded first: the server answers one request per client at a time.
      await waitForBoard(popup);
      await popup.close();
      expect(await tabTitles(page)).toEqual(before);

      // A reload brings the tabs and the tab on screen back.
      await page.reload();
      await waitForBoard(page);
      expect(await tabTitles(page)).toEqual(before);
      expect(await selectedTab(page)).toBe(await boardTitle(page));

      // The palette: Enter replaces the preview tab, Ctrl Enter opens a new tab.
      const open = async (query: string, key: string) => {
        await page.keyboard.press("Control+k");
        await page.locator(".palette input[role=combobox]").fill(query);
        await page.keyboard.press(key);
        await waitForBoard(page);
      };
      await open("Cart", "Enter");
      expect(await viewerPreviewTitle(page)).toBe("Cart screen (mobile)");
      await open("Jobs", "Control+Enter");
      expect(await selectedTab(page)).toBe("Shop background jobs");
      expect((await tabTitles(page)).length).toBe(before.length + 1);

      // A pasted board opens in a pinned tab of its own, asking nothing, and is gone after a
      // reload; the preview tab keeps its board.
      const count = (await tabTitles(page)).length;
      const pasteAsked: string[] = [];
      const onPasteDialog = (dialog: { message: () => string; accept: () => Promise<void> }) => {
        pasteAsked.push(dialog.message());
        void dialog.accept();
      };
      page.on("dialog", onPasteDialog);
      await page.getByRole("button", { name: "Open file", exact: true }).first().click();
      const pasted = readFileSync(path.join(atlasDir, "place-order.board.json"), "utf8");
      await page.locator(".file-dialog textarea").fill(pasted);
      await page.locator(".file-dialog").getByRole("button", { name: "Render" }).click();
      await waitForBoard(page);
      expect(await tabTitles(page)).toHaveLength(count + 1);
      expect(await selectedTab(page)).toBe("Place order (web)");
      expect(await page.locator(".tab.active.preview").count()).toBe(0);
      expect(await viewerPreviewTitle(page)).toBe("Cart screen (mobile)");
      expect(new URL(page.url()).hash).toBe("#/");
      // An ordinary click goes to the preview tab; the pasted board stays open.
      await sidebarLink(page, "Cart screen").click();
      await waitForBoard(page);
      expect(await tabTitles(page)).toContain("Place order (web)");
      expect(pasteAsked).toEqual([]);
      page.off("dialog", onPasteDialog);
      await page.getByRole("tab", { name: "Place order (web)" }).click();
      await waitForBoard(page);
      // The address names the home: the reload shows it, with the other tabs kept.
      await page.reload();
      await page.locator(".atlas-home").waitFor({ timeout: 30_000 });
      expect(await tabTitles(page)).toHaveLength(count);
      expect(await tabTitles(page)).not.toContain("Place order (web)");
      await page.keyboard.press("Alt+1");
      await waitForBoard(page);

      // Edit pins the tab; with the layout changed, Alt W asks before closing it.
      await sidebarLink(page, "Cart screen").click();
      await waitForBoard(page);
      expect(await viewerPreviewTitle(page)).toBe("Cart screen (mobile)");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).waitFor();
      expect(await page.locator(".tab.active.preview").count()).toBe(0);
      const canvasBox = await page.locator(".canvas").boundingBox();
      if (!canvasBox) throw new Error("no canvas");
      // Empty canvas, right of the board and left of the edit panel.
      await page.mouse.click(canvasBox.x + 450, canvasBox.y + canvasBox.height - 120);
      await page.keyboard.press("Control+a");
      for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
      const editAsked: string[] = [];
      page.once("dialog", (dialog) => {
        editAsked.push(dialog.message());
        void dialog.dismiss();
      });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Alt+w");
      await page.waitForTimeout(400);
      expect(editAsked).toHaveLength(1);
      expect(editAsked[0]).toMatch(/unsaved changes/);
      expect(await selectedTab(page)).toBe("Cart screen (mobile)");
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await waitForBoard(page);
      await page.keyboard.press("Alt+1");
      await waitForBoard(page);

      // Changes on the canvas outside edit mode: choosing another tab asks first.
      const box = await page.locator(".canvas").boundingBox();
      if (!box) throw new Error("no canvas");
      await page.mouse.click(box.x + box.width - 80, box.y + box.height - 80);
      await page.keyboard.press("r");
      await page.mouse.move(box.x + box.width - 300, box.y + box.height - 220);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 200, box.y + box.height - 140);
      await page.mouse.up();
      await page.locator(".canvas-unsaved").waitFor();
      const asked: string[] = [];
      page.once("dialog", (dialog) => {
        asked.push(dialog.message());
        void dialog.dismiss();
      });
      await page.keyboard.press("Escape");
      const stay = await selectedTab(page);
      await page.keyboard.press("Alt+2");
      await page.waitForTimeout(400);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatch(/not saved/);
      expect(await page.locator(".canvas-unsaved").count()).toBe(1);
      expect(await selectedTab(page)).toBe(stay);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("on an exported page inside an iframe, with no request on the way back to a tab", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "gb-tabs-export-"));
    try {
      await exportAtlas({ dir: atlasDir, root: fixtures, out, webRoot }, () => undefined);
      const exported = new Hono().use(
        "/*",
        serveStatic({ root: path.relative(process.cwd(), out) }),
      );
      const site = await listen(exported.fetch);
      const host = new Hono().get("/", (c) =>
        c.html(
          `<!doctype html><iframe src="${site.origin.replace("127.0.0.1", "localhost")}/index.html#/" style="width:1400px;height:860px;border:0"></iframe>`,
        ),
      );
      const outer = await listen(host.fetch);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
        await page.goto(outer.origin);
        const frame = await frameOf(page);
        await frame.locator(".atlas-home").waitFor({ timeout: 30_000 });
        await exercise(page, frame, ["Checkout screen", "Orders API", "Shop database"]);
        const requests: string[] = [];
        page.on("request", (request) => {
          if (request.url().includes("/data/boards/")) requests.push(request.url());
        });
        await page.keyboard.press("Alt+2");
        await waitForBoard(frame);
        await page.keyboard.press("Alt+1");
        await waitForBoard(frame);
        expect(requests).toEqual([]);
        expect(page.url()).toBe(`${outer.origin}/`);
      } finally {
        await context.close();
        await outer.close();
        await site.close();
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("in the list of boards kept in the browser", async () => {
    const server = await start({});
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await openExampleBoards(page, server.origin, atlasDir);
      const titles = (
        await page.locator(".sidebar .nav-group a.nav-item .nav-label").allTextContents()
      ).slice(0, 3);
      await exercise(page, page, titles);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("each tab keeps its own toolbar choices, and a new tab starts with the last made", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout`);
      await waitForBoard(page);
      await sidebarLink(page, "Cart screen").click({ modifiers: ["Alt"] });
      await waitForBoard(page);
      const font = page.locator(".font-picker select");
      const design = page.locator(".toolbar-actions button[aria-pressed]", { hasText: "Design" });
      const sources = page.getByRole("button", { name: "Sources panel", exact: true });
      const choices = async () => ({
        title: await boardTitle(page),
        font: await font.inputValue(),
        design: (await design.count()) > 0 ? await design.getAttribute("aria-pressed") : null,
        sources: await sources.getAttribute("aria-pressed"),
        panel: await page.locator(".source-panel").count(),
      });
      expect(await choices()).toMatchObject({ font: "sans", sources: "true", panel: 1 });

      // Tab A (checkout): switch the font, close the source panel, and hide the design images
      // when the board has any (the fixtures cache no Figma image, so it may have none).
      await page.getByRole("tab").first().click();
      await waitForBoard(page);
      if ((await design.count()) > 0) await design.click();
      await font.selectOption("mono");
      await sources.click();
      const a = await choices();
      expect(a).toMatchObject({ font: "mono", sources: "false", panel: 0 });
      expect(a.design).not.toBe("true");

      // Tab B kept its own.
      await page.keyboard.press("Alt+2");
      await waitForBoard(page);
      const b = await choices();
      expect(b).toMatchObject({ font: "sans", sources: "true", panel: 1 });
      // Back to A: its choices come back.
      await page.keyboard.press("Alt+1");
      await waitForBoard(page);
      expect(await choices()).toEqual(a);

      // A reload keeps each tab's choices.
      await page.reload();
      await waitForBoard(page);
      expect(await choices()).toEqual(a);
      await page.keyboard.press("Alt+2");
      await waitForBoard(page);
      expect(await choices()).toEqual(b);

      // A new tab starts with the choices made last (tab A's).
      await page.keyboard.press("Control+k");
      await page.locator(".palette input[role=combobox]").fill("Orders API");
      await page.keyboard.press("Control+Enter");
      await waitForBoard(page);
      expect(await selectedTab(page)).toBe(await boardTitle(page));
      expect(await choices()).toMatchObject({ font: "mono", sources: "false", panel: 0 });
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("an atlas of one board has no tab bar", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gb-tabs-one-"));
    try {
      const board = readFileSync(path.join(atlasDir, "web--checkout.board.json"), "utf8");
      await writeFile(path.join(dir, "web--checkout.board.json"), board);
      expect(await readdir(dir)).toHaveLength(1);
      const server = await start({ atlas: { dir: realpathSync(dir), root: fixtures } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
        await page.goto(`${server.origin}/#/board/web--checkout`);
        await waitForBoard(page);
        expect(await page.locator(".tab-bar").count()).toBe(0);
        expect(await page.locator(".nav-action").count()).toBe(0);
      } finally {
        await context.close();
        await server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const viewerPreviewTitle = (viewer: Viewer) =>
  viewer.locator(".tab.preview .tab-title").textContent();

async function frameOf(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector("iframe");
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("no frame");
  return frame;
}
