// Layout editing in the built viewer: a box moved on a local `serve --atlas` is saved to the
// overlay file beside the board, and drawn there again after a reload; elsewhere it is a draft
// kept in the browser. Needs `pnpm -r build` and `pnpm exec playwright install --only-shell
// chromium` first.
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type AppOptions, createApp } from "../src/server/app.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));

let browser: Browser;
let project: string;

async function start(options: AppOptions) {
  const built = createApp({ webRoot, ...options });
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

beforeAll(async () => {
  if (!existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`${webRoot} is missing; run "pnpm -r build" first`);
  }
  project = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-layout-")));
  cpSync(fixtures, project, { recursive: true });
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
});

async function waitForBoard(page: Page): Promise<void> {
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

/** Drags whatever sits at the centre of the canvas by (dx, dy) screen pixels. */
async function dragCentre(page: Page, dx: number, dy: number) {
  const box = await page.locator(".canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/**
 * Opens a board on one node (the deep link puts it at the centre of the canvas, at 100%),
 * starts layout editing, drags the node and saves.
 */
async function nudge(page: Page, origin: string, slug: string, nodeId: string, dx: number) {
  await page.goto(`${origin}/#/board/${slug}?node=${nodeId}`);
  await waitForBoard(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  await page.waitForTimeout(300);
  await dragCentre(page, dx, 0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

describe("layout editing", () => {
  test("a box moved on a local serve --atlas is saved beside the board and drawn there again", async () => {
    const dir = path.join(project, ".groundboard");
    const server = await start({ host: "127.0.0.1", atlas: { dir, root: project } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const problems: string[] = [];
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => problems.push(error.message));
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await nudge(page, server.origin, "place-order", "post", 60);
      const file = path.join(dir, "place-order.overlay.json");
      await expect.poll(() => existsSync(file), { timeout: 15_000 }).toBe(true);
      const overlay = JSON.parse(readFileSync(file, "utf8"));
      expect(overlay.nodes.post.dx).toBeGreaterThan(40);
      expect(overlay.nodes.post.dy).toBeCloseTo(0, 0);
      expect(overlay.notes).toEqual([]);
      // The board comes back from the server with the box where it was dropped, still editable,
      // and a second save carries the ETag of the first.
      await page.waitForTimeout(1500);
      await waitForBoard(page);
      await page.getByRole("button", { name: "Save", exact: true }).waitFor();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Reset layout" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(1500);
      await expect
        .poll(() => JSON.parse(readFileSync(file, "utf8")).nodes, { timeout: 15_000 })
        .toEqual({});
      expect(problems).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("a label edited on a local serve --atlas is saved manual, its sources kept to check again", async () => {
    const dir = path.join(project, ".groundboard");
    const server = await start({ host: "127.0.0.1", atlas: { dir, root: project } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const problems: string[] = [];
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => problems.push(error.message));
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/place-order?node=press`);
      await waitForBoard(page);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const panel = page.locator(".edit-panel");
      await panel.waitFor();
      const label = panel.locator("section.edit-section").getByLabel("Label");
      const before = await label.inputValue();
      // A drag and then a label edit: two steps of one history.
      await dragCentre(page, 60, 0);
      await page.waitForTimeout(300);
      await label.fill("Press Place order twice");
      await label.blur();
      await page.waitForTimeout(800);
      // Ctrl Z undoes the label edit first, Ctrl Shift Z brings it back; the box stays dropped.
      await page.keyboard.press("Control+z");
      await expect.poll(() => label.inputValue(), { timeout: 10_000 }).toBe(before);
      await page.keyboard.press("Control+Shift+z");
      await expect
        .poll(() => label.inputValue(), { timeout: 10_000 })
        .toBe("Press Place order twice");
      // The viewport did not jump back to fit the board.
      expect(await page.getByText("100%").isVisible()).toBe(true);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const file = path.join(dir, "place-order.board.json");
      await expect
        .poll(
          () =>
            JSON.parse(readFileSync(file, "utf8")).nodes.find(
              (n: { id: string }) => n.id === "press",
            ),
          {
            timeout: 15_000,
          },
        )
        .toMatchObject({ label: "Press Place order twice", manual: true });
      const saved = JSON.parse(readFileSync(file, "utf8")).nodes.find(
        (n: { id: string }) => n.id === "press",
      );
      expect(saved.priorSourceIds.length).toBeGreaterThan(0);
      // The drag went into the same save, beside the board.
      const overlayFile = path.join(dir, "place-order.overlay.json");
      await expect
        .poll(
          () =>
            existsSync(overlayFile) && JSON.parse(readFileSync(overlayFile, "utf8")).nodes.press,
          {
            timeout: 15_000,
          },
        )
        .toBeTruthy();
      expect(saved.sourceIds).toBeUndefined();
      expect(before).not.toBe("Press Place order twice");
      expect(problems).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("elsewhere a saved layout is a draft that outlives a reload", async () => {
    const dir = path.join(project, ".groundboard");
    rmSync(path.join(dir, "place-order.overlay.json"), { force: true });
    // Off loopback the write routes do not exist; the viewer keeps a draft instead.
    const server = await start({
      host: "0.0.0.0",
      token: "t0ken",
      allowedHosts: ["127.0.0.1"],
      atlas: { dir, root: project },
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("groundboard.locale", "en");
        sessionStorage.setItem("groundboard.token", "t0ken");
      });
      await nudge(page, server.origin, "place-order", "post", 60);
      await page.getByText("Draft", { exact: true }).waitFor({ timeout: 15_000 });
      await page.reload();
      await waitForBoard(page);
      await page.getByText("Draft", { exact: true }).waitFor({ timeout: 15_000 });
      expect(existsSync(path.join(dir, "place-order.overlay.json"))).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });
});
