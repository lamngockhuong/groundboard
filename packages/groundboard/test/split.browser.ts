// Split view of the built viewer: two boards side by side, opened by the tab bar's button, a
// tab's menu (from the keyboard too) and the palette; one source panel that follows the
// focused pane; keys that act on that pane only; a handle that resizes the panes and is kept
// across a reload; one pane edited or presenting at a time; a narrow window folds both panes
// into one row of tabs and unfolds them as they were. On a served atlas and on an exported
// page inside an iframe. Needs `pnpm -r build` and
// `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, realpathSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type Browser, chromium, type Frame, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exportAtlas } from "../src/commands/export.ts";
import { type AppOptions, createApp } from "../src/server/app.ts";

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

/** Waits until every board on screen is on its canvas. */
async function settled(viewer: Viewer): Promise<void> {
  await viewer.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  // A narrow window keeps the other pane's board hidden: the one in sight is waited for.
  await viewer
    .locator(".canvas .main-menu-trigger")
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 30_000 });
  await viewer.waitForTimeout(700);
}

const pane = (viewer: Viewer, i: 0 | 1) => viewer.locator(".pane").nth(i);
const focusedPane = (viewer: Viewer) => viewer.locator(".pane.pane-focused");
const paneTitle = (p: Locator) => p.locator(".board-title-text").textContent();
const paneTabs = (p: Locator) => p.locator('[role="tab"] .tab-title').allTextContents();
const sidebarLink = (viewer: Viewer, title: string) =>
  viewer.locator(".sidebar .nav-group a.nav-item", { hasText: title }).first();

/** Excalidraw's own state in a pane: where its canvas stands, and its tool. */
async function canvasState(p: Locator) {
  return p.locator(".excalidraw").evaluate((el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    // biome-ignore lint/suspicious/noExplicitAny: React's fiber is untyped.
    let fiber: any = key ? (el as any)[key] : null;
    while (fiber) {
      const state = fiber.stateNode?.state;
      if (state && "scrollX" in state && "zoom" in state) {
        return {
          scrollX: Math.round(state.scrollX),
          scrollY: Math.round(state.scrollY),
          zoom: Math.round(state.zoom.value * 1000) / 1000,
          tool: state.activeTool.type as string,
        };
      }
      fiber = fiber.return;
    }
    return null;
  });
}

/** Zooms in and pans a pane's canvas, so its view is not the one a board opens at. */
async function moveCanvas(page: Page, p: Locator): Promise<void> {
  const box = await p.locator(".canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.mouse.wheel(120, 80);
  await page.waitForTimeout(400);
}

/** Opens the palette and runs what the query finds first. */
async function palette(page: Page, viewer: Viewer, query: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await viewer.locator(".palette input[role=combobox]").fill(query);
  await page.keyboard.press("Enter");
}

describe("split view", () => {
  test("on a served atlas", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout`);
      await settled(page);
      await sidebarLink(page, "Orders API").click({ modifiers: ["Alt"] });
      await settled(page);
      expect(await page.locator(".split-one").count()).toBe(1);

      // The tab bar's button: the board on screen opens beside it, in the right pane.
      await page.getByRole("button", { name: "Open beside" }).click();
      await settled(page);
      expect(await page.locator(".pane").count()).toBe(2);
      expect(await paneTabs(pane(page, 0))).toEqual(["Checkout screen", "Orders API"]);
      expect(await paneTabs(pane(page, 1))).toEqual(["Orders API"]);
      expect(await focusedPane(page).getAttribute("aria-label")).toBe("right pane, active pane");
      expect(page.url()).toMatch(/#\/board\/api--orders$/);
      expect(await page.locator(".excalidraw").count()).toBe(2);
      expect(await page.locator(".source-panel").count()).toBe(1);

      // A tab's menu, from the keyboard: Shift F10 on the left pane's other tab.
      await pane(page, 0).getByRole("tab", { name: "Checkout screen" }).focus();
      await page.keyboard.press("Shift+F10");
      const menu = page.getByRole("menu", { name: "Actions for Checkout screen" });
      await menu.waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      expect(await page.evaluate('document.activeElement?.textContent?.includes("Checkout")')).toBe(
        true,
      );
      await page.keyboard.press("Shift+F10");
      await menu.waitFor();
      await menu.getByRole("menuitem", { name: "Open beside" }).click();
      await settled(page);
      expect(await paneTabs(pane(page, 1))).toEqual(["Orders API", "Checkout screen"]);
      expect(await paneTitle(pane(page, 1))).toBe("Checkout screen");
      expect(page.url()).toMatch(/#\/board\/web--checkout$/);

      // A right click opens the same menu at the pointer; the browser's menu stays closed.
      await pane(page, 1).getByRole("tab", { name: "Orders API" }).click({ button: "right" });
      await page.getByRole("menu", { name: "Actions for Orders API" }).waitFor();
      await page.keyboard.press("Escape");

      // The palette's command, from the left pane: its board is in the right group already,
      // so that tab is shown there.
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      expect(page.url()).toMatch(/#\/board\/api--orders$/);
      await palette(page, page, "beside");
      await settled(page);
      expect(await paneTitle(pane(page, 1))).toBe("Orders API");
      expect(await paneTabs(pane(page, 1))).toEqual(["Orders API", "Checkout screen"]);

      // The source panel follows the focused pane: a node picked in the palette shows its
      // citations, and the other pane's selection (none) shows when it takes the focus.
      await palette(page, page, "create-order");
      await page.waitForTimeout(800);
      expect(await page.locator(".source-panel").textContent()).not.toMatch(/Select a node/);
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      expect(await page.locator(".source-panel").textContent()).toMatch(/Select a node/);

      // "]" steps the focused pane only.
      await pane(page, 0).getByRole("tab", { name: "Checkout screen" }).click();
      await settled(page);
      const rightBefore = await paneTitle(pane(page, 1));
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("[");
      await settled(page);
      expect(await paneTitle(pane(page, 0))).toBe("Cart screen (mobile)");
      expect(await paneTitle(pane(page, 1))).toBe(rightBefore);

      // Excalidraw's tool keys act on the canvas with the keyboard only.
      await pane(page, 1)
        .locator(".canvas")
        .click({ position: { x: 40, y: 400 } });
      await page.keyboard.press("r");
      expect((await canvasState(pane(page, 1)))?.tool).toBe("rectangle");
      expect((await canvasState(pane(page, 0)))?.tool).toBe("selection");
      await page.keyboard.press("v");

      // The handle: arrow keys, a drag, kept across a reload, a double click for half and half.
      const handle = page.getByRole("separator", { name: "Resize the panes" });
      expect(await handle.getAttribute("aria-valuenow")).toBe("50");
      await handle.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      expect(await handle.getAttribute("aria-valuenow")).toBe("62");
      const area = await page.locator(".split").boundingBox();
      const grip = await handle.boundingBox();
      if (!area || !grip) throw new Error("no split");
      await page.mouse.move(grip.x + 1, grip.y + 200);
      await page.mouse.down();
      await page.mouse.move(area.x + area.width * 0.4, grip.y + 200, { steps: 5 });
      await page.mouse.up();
      expect(await handle.getAttribute("aria-valuenow")).toBe("40");
      const leftWidth = (await pane(page, 0).boundingBox())?.width ?? 0;
      expect(Math.abs(leftWidth / area.width - 0.4)).toBeLessThan(0.02);

      // Each pane keeps its view across a reload, and so do the panes and the ratio.
      await moveCanvas(page, pane(page, 1));
      const rightView = await canvasState(pane(page, 1));
      const tabsBefore = [await paneTabs(pane(page, 0)), await paneTabs(pane(page, 1))];
      await page.reload();
      await settled(page);
      expect([await paneTabs(pane(page, 0)), await paneTabs(pane(page, 1))]).toEqual(tabsBefore);
      expect(await handle.getAttribute("aria-valuenow")).toBe("40");
      expect(await canvasState(pane(page, 1))).toEqual(rightView);
      await handle.dblclick();
      expect(await handle.getAttribute("aria-valuenow")).toBe("50");

      // Narrower than 1024px: one row of tabs, one board in sight (the other pane's stays on
      // the page, hidden), no handle, no button to split.
      await page.setViewportSize({ width: 900, height: 900 });
      await settled(page);
      expect(await page.locator(".split-one").count()).toBe(1);
      expect(await page.locator(".pane:not([hidden]) .excalidraw").count()).toBe(1);
      expect(await page.locator(".excalidraw").count()).toBe(2);
      expect(await page.locator(".split-handle").count()).toBe(0);
      expect(await page.locator('[role="tab"] .tab-title').allTextContents()).toEqual(
        tabsBefore.flat(),
      );
      expect(await page.getByRole("button", { name: "Open beside" }).count()).toBe(0);
      await page.keyboard.press("Control+k");
      await page.locator(".palette input[role=combobox]").fill("beside");
      expect(await page.locator(".palette-option").count()).toBe(0);
      await page.keyboard.press("Escape");
      // Wide again: both panes as they were, the right one where it was left.
      await page.setViewportSize({ width: 1440, height: 900 });
      await settled(page);
      expect([await paneTabs(pane(page, 0)), await paneTabs(pane(page, 1))]).toEqual(tabsBefore);
      expect(await canvasState(pane(page, 1))).toEqual(rightView);

      // One pane edits at a time: the other pane's Edit is off, and says why.
      await pane(page, 0).getByRole("button", { name: "Edit", exact: true }).click();
      await pane(page, 0).getByRole("button", { name: "Done" }).waitFor();
      const otherEdit = pane(page, 1).getByRole("button", { name: "Edit", exact: true });
      expect(await otherEdit.isDisabled()).toBe(true);
      expect(await otherEdit.getAttribute("title")).toMatch(/other pane is being edited/);
      await pane(page, 0).getByRole("button", { name: "Done" }).click();
      await pane(page, 0).getByRole("button", { name: "Edit", exact: true }).waitFor();
      expect(await otherEdit.isDisabled()).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("a board on screen keeps its editor, and its edit session, when a pane comes or goes", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout`);
      await settled(page);
      // Mark the canvas: a canvas mounted again would not carry the mark.
      const mark = () =>
        page.evaluate(
          `document.querySelectorAll(".excalidraw").forEach((el) => { el.dataset.kept = "1"; })`,
        );
      const kept = (p: Locator) => p.locator('.excalidraw[data-kept="1"]').count();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Done" }).waitFor();
      await mark();
      await page.getByRole("button", { name: "Open beside" }).first().click();
      await settled(page);
      expect(await kept(pane(page, 0))).toBe(1);
      expect(await pane(page, 0).getByRole("button", { name: "Done" }).count()).toBe(1);
      // Closing the right pane's only tab: the left board stays as it is.
      await pane(page, 1).getByRole("tab").first().focus();
      await page.keyboard.press("Delete");
      await page.waitForTimeout(500);
      expect(await page.locator(".pane").count()).toBe(1);
      expect(await page.locator('.excalidraw[data-kept="1"]').count()).toBe(1);
      expect(await page.getByRole("button", { name: "Done" }).count()).toBe(1);
      // A narrow window hides the other pane: neither board mounts again, and a change drawn on
      // the right canvas (not saved) is still there when the window widens; nothing asks.
      await page.getByRole("button", { name: "Open beside" }).first().click();
      await settled(page);
      await mark();
      const canvas = await pane(page, 1).locator(".canvas").boundingBox();
      if (!canvas) throw new Error("no canvas");
      await page.mouse.click(canvas.x + 40, canvas.y + canvas.height - 160);
      await page.keyboard.press("r");
      await page.mouse.move(canvas.x + 60, canvas.y + canvas.height - 120);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 140, canvas.y + canvas.height - 60, { steps: 4 });
      await page.mouse.up();
      await pane(page, 1).locator(".canvas-unsaved").waitFor();
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      let asked = 0;
      page.on("dialog", (dialog) => {
        asked += 1;
        void dialog.dismiss();
      });
      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForTimeout(500);
      expect(await page.locator('.excalidraw[data-kept="1"]').count()).toBe(2);
      expect(await page.getByRole("button", { name: "Done" }).count()).toBe(1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);
      expect(await page.locator('.excalidraw[data-kept="1"]').count()).toBe(2);
      expect(await pane(page, 1).locator(".canvas-unsaved").count()).toBe(1);
      expect(asked).toBe(0);
      await pane(page, 0).getByRole("button", { name: "Done" }).click();
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("the atlas home takes the focused pane only, beside the other pane's board", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout`);
      await settled(page);
      await sidebarLink(page, "Orders API").click({ modifiers: ["Alt"] });
      await settled(page);
      await page.getByRole("button", { name: "Open beside" }).click();
      await settled(page);
      await page.evaluate(
        `document.querySelector(".pane:nth-child(3) .excalidraw").dataset.kept = "1"`,
      );
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      await page.locator(".sidebar a.nav-home").click();
      await pane(page, 0).locator(".atlas-home").waitFor();
      expect(page.url()).toMatch(/#\/$/);
      expect(await paneTitle(pane(page, 1))).toBe("Orders API");
      expect(await pane(page, 1).locator('.excalidraw[data-kept="1"]').count()).toBe(1);
      expect(await paneTabs(pane(page, 0))).toEqual(["Checkout screen", "Orders API"]);
      expect(await pane(page, 0).locator('[role="tab"][aria-selected="true"]').count()).toBe(0);
      // A board chosen in the sidebar goes into the pane the home was in.
      await sidebarLink(page, "Shop database").click();
      await settled(page);
      expect(await paneTitle(pane(page, 0))).toBe("Shop database");
      expect(await pane(page, 1).locator('.excalidraw[data-kept="1"]').count()).toBe(1);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("a pane's own toolbar button turns the source panel off, from either pane", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout`);
      await settled(page);
      await page.getByRole("button", { name: "Open beside" }).click();
      await settled(page);
      const toggle = (i: 0 | 1) => pane(page, i).getByRole("button", { name: "Sources panel" });
      // One panel for both panes: either pane's button opens and closes it for both, and a
      // click on the button of the pane not focused is never lost to the panes moving.
      const pressed = async () => [
        await toggle(0).getAttribute("aria-pressed"),
        await toggle(1).getAttribute("aria-pressed"),
      ];
      await toggle(0).click();
      expect(await page.locator(".source-panel").count()).toBe(0);
      expect(await pressed()).toEqual(["false", "false"]);
      await toggle(1).click();
      expect(await page.locator(".source-panel").count()).toBe(1);
      expect(await pressed()).toEqual(["true", "true"]);
      await toggle(0).click();
      expect(await page.locator(".source-panel").count()).toBe(0);
      expect(await pressed()).toEqual(["false", "false"]);
      // The button that opens a board beside is not the one of the source panel.
      expect(await pane(page, 0).locator(".tab-actions .icon").innerHTML()).not.toBe(
        await toggle(0).locator(".icon").innerHTML(),
      );
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("presenting in one pane leaves the other pane's keys and button alone", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/place-order`);
      await settled(page);
      await page.getByRole("button", { name: "Open beside" }).click();
      await settled(page);
      // Present on the left; the right pane shows the same flow.
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      const rightView = await canvasState(pane(page, 1));
      await pane(page, 0).getByRole("button", { name: "Present", exact: true }).click();
      const counter = pane(page, 0).locator(".present-counter");
      await counter.waitFor();
      const first = await counter.textContent();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      expect(await counter.textContent()).not.toBe(first);
      expect(await canvasState(pane(page, 1))).toEqual(rightView);
      const otherPresent = pane(page, 1).getByRole("button", { name: "Present", exact: true });
      expect(await otherPresent.isDisabled()).toBe(true);
      // The right pane focused: the arrow keys no longer step the left pane's presentation.
      await pane(page, 1)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      const now = await counter.textContent();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      expect(await counter.textContent()).toBe(now);
      await pane(page, 0)
        .locator(".toolbar")
        .click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("Escape");
      await counter.waitFor({ state: "hidden" });
      expect(await otherPresent.isDisabled()).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("on an exported page inside an iframe", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "gb-split-export-"));
    try {
      await exportAtlas({ dir: atlasDir, root: fixtures, out, webRoot }, () => undefined);
      const exported = new Hono().use(
        "/*",
        serveStatic({ root: path.relative(process.cwd(), out) }),
      );
      const site = await listen(exported.fetch);
      const host = new Hono().get("/", (c) =>
        c.html(
          `<!doctype html><iframe src="${site.origin.replace("127.0.0.1", "localhost")}/index.html#/board/web--checkout" style="width:1400px;height:860px;border:0"></iframe>`,
        ),
      );
      const outer = await listen(host.fetch);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
        await page.goto(outer.origin);
        const handle = await page.waitForSelector("iframe");
        const frame = await handle.contentFrame();
        if (!frame) throw new Error("no frame");
        await settled(frame);
        await frame.getByRole("button", { name: "Open beside" }).click();
        await settled(frame);
        expect(await frame.locator(".pane").count()).toBe(2);
        expect(await paneTitle(pane(frame, 0))).toBe("Checkout screen");
        expect(await paneTitle(pane(frame, 1))).toBe("Checkout screen");
        await pane(frame, 0)
          .locator(".toolbar")
          .click({ position: { x: 5, y: 5 } });
        expect(await focusedPane(frame).getAttribute("aria-label")).toBe("left pane, active pane");
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
});
