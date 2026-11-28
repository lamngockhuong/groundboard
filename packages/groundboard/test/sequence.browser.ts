// A sequence board in the built viewer: selecting a message, a guard and a participant shows what
// each cites; a double click on a message that writes a table opens the table; the palette
// finds a message; Previous and Next step through the messages; the endpoint the sequence
// explains loses its hint only when a participant carries its ref; PNG and SVG export; and the
// presentation takes one step per message. Needs `pnpm -r build` and
// `pnpm exec playwright install --only-shell chromium` first.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sequenceBoard } from "../../schema/test/sequence-board.ts";
import { renderBoard } from "../src/pipeline.ts";
import { createApp } from "../src/server/app.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));
const SLUG = "pay-sequence";
const scratch = (process.env.GROUNDBOARD_SHOTS ?? "").trim();

let browser: Browser;
let root: string;

/** The fixture atlas, the sample's handler sequence left out, and the test's sequence added. */
function atlasWith(board: Record<string, unknown>, handler: object | null): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-sequence-")));
  cpSync(fixtures, dir, { recursive: true });
  rmSync(path.join(dir, ".groundboard", "place-order-handler.board.json"));
  writeFileSync(path.join(dir, ".groundboard", `${SLUG}.board.json`), JSON.stringify(board));
  const apiFile = path.join(dir, ".groundboard", "api--orders.board.json");
  const api = JSON.parse(readFileSync(apiFile, "utf8")) as {
    nodes: Array<Record<string, unknown>>;
  };
  const post = api.nodes.find((n) => n.id === "create-order") as Record<string, unknown>;
  if (handler) post.handler = handler;
  writeFileSync(apiFile, JSON.stringify(api));
  return dir;
}

async function start(dir: string) {
  const built = createApp({
    host: "127.0.0.1",
    webRoot,
    atlas: { dir: path.join(dir, ".groundboard"), root: dir },
  });
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
  root = atlasWith(sequenceBoard(), { shape: "sequence", sourceIds: ["route-post"] });
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

async function waitForBoard(page: Page): Promise<void> {
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

type SceneElement = { id: string; x: number; y: number; width: number; height: number };

/**
 * Where an element of the sequence is on screen: the deep link put `anchor` at the centre of the
 * canvas at the zoom the zoom button reads, and the element sits where the scene puts it.
 */
async function screenPoint(page: Page, anchor: string, elementId: string) {
  const result = await renderBoard(sequenceBoard());
  if (!result.scene) throw new Error("the sequence did not render");
  const elements = result.scene.elements as unknown as SceneElement[];
  const find = (id: string) => {
    const el = elements.find((e) => e.id === id);
    if (!el) throw new Error(`no ${id}`);
    return el;
  };
  const centre = (e: SceneElement) => [e.x + e.width / 2, e.y + e.height / 2] as const;
  const [ax, ay] = centre(find(anchor));
  const [ex, ey] = centre(find(elementId));
  const zoomText = await page.locator(".canvas .reset-zoom-button").first().textContent();
  const zoom = Number.parseInt(zoomText ?? "100", 10) / 100;
  const canvas = await page.locator(".canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  return {
    x: canvas.x + canvas.width / 2 + (ex - ax) * zoom,
    y: canvas.y + canvas.height / 2 + (ey - ay) * zoom,
  };
}

const panel = (page: Page) => page.locator(".source-panel");

describe("a sequence board in the viewer", () => {
  test("selects messages, guards and participants, and steps through the messages", async () => {
    const server = await start(root);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));

      // A deep link to message 2 selects it.
      await page.goto(`${server.origin}/#/board/${SLUG}?node=m2`);
      await waitForBoard(page);
      const head = panel(page).locator(".node-head .node-label");
      await head.getByText("2. authorize(amount)").waitFor({ timeout: 10_000 });
      expect(await panel(page).locator(".node-head .kind").textContent()).toBe(
        "Call, waits for the answer",
      );
      expect(await panel(page).locator(".node-from").textContent()).toBe(
        "From Orders API to Payment gateway",
      );
      expect(await panel(page).locator(".quote").first().textContent()).toBe(
        "await gateway.authorize",
      );

      // The keyboard steps to the next message, and back.
      await panel(page).getByRole("button", { name: "Next message" }).focus();
      await page.keyboard.press("Enter");
      await head.getByText("3. authorization id").waitFor({ timeout: 10_000 });
      expect(page.url()).toContain("node=m3");
      await panel(page).getByRole("button", { name: "Previous message" }).click();
      await head.getByText("2. authorize(amount)").waitFor();

      // A click on the guard of the declined branch shows the condition and its source.
      await page.goto(`${server.origin}/#/board/${SLUG}?node=m4`);
      await waitForBoard(page);
      const canvas = await page.locator(".canvas").boundingBox();
      // Empty canvas: the deep link's selection opens Excalidraw's style panel over the left side.
      if (canvas)
        await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 60);
      const guard = await screenPoint(page, "edge/m4", "operand-guard/declined");
      await page.mouse.click(guard.x, guard.y);
      await panel(page)
        .locator(".node-head .kind")
        .getByText("alt: one of several branches")
        .waitFor({
          timeout: 10_000,
        });
      expect(await panel(page).locator(".action").textContent()).toContain("declined");
      expect(await panel(page).locator(".quote").first().textContent()).toBe("if (!authorized)");

      // A participant names its category.
      await page.goto(`${server.origin}/#/board/${SLUG}?node=bank`);
      await waitForBoard(page);
      await panel(page).locator(".node-head .kind").getByText("External service").waitFor();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("a double click on a message that writes a table opens the table; the palette finds a message", async () => {
    const server = await start(root);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/${SLUG}?node=m4`);
      await waitForBoard(page);
      const canvas = await page.locator(".canvas").boundingBox();
      // Empty canvas: the deep link's selection opens Excalidraw's style panel over the left side.
      if (canvas)
        await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 60);
      const label = await screenPoint(page, "edge/m4", "edge-label/m4");
      await page.mouse.dblclick(label.x, label.y);
      await page.waitForURL(/#\/board\/overview-db/, { timeout: 15_000 });
      await waitForBoard(page);
      await panel(page).locator(".node-id").getByText("orders", { exact: true }).waitFor();

      await page.goto(`${server.origin}/#/board/${SLUG}`);
      await waitForBoard(page);
      await page.keyboard.press("Control+k");
      await page.keyboard.type("authorize");
      const option = page.getByRole("option", { name: /2\. authorize\(amount\)/ });
      await option.waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await panel(page)
        .locator(".node-head .node-label")
        .getByText("2. authorize(amount)")
        .waitFor();
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("explains the endpoint only when a participant carries its ref", async () => {
    const hintOn = async (dir: string) => {
      const server = await start(dir);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
        await page.goto(`${server.origin}/#/board/api--orders?node=create-order`);
        await waitForBoard(page);
        await panel(page).locator(".node-sources").first().waitFor();
        await page.waitForTimeout(300);
        return await panel(page).locator(".flow-hint").count();
      } finally {
        await context.close();
        await server.close();
      }
    };
    expect(await hintOn(root)).toBe(0);
    // Only the first message carries the endpoint's ref now: nothing explains the handler.
    const raw = sequenceBoard();
    delete (raw.nodes[1] as Record<string, unknown>).ref;
    const messageOnly = atlasWith(raw, { shape: "sequence", sourceIds: ["route-post"] });
    try {
      expect(await hintOn(messageOnly)).toBe(1);
    } finally {
      rmSync(messageOnly, { recursive: true, force: true });
    }
  });

  test("exports PNG and SVG, presents one message per step, and stays legible in dark mode", async () => {
    const server = await start(root);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/${SLUG}`);
      await waitForBoard(page);
      for (const format of ["PNG", "SVG"]) {
        await page.getByRole("button", { name: "Export" }).click();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("menuitem", { name: new RegExp(`^${format}`) }).click(),
        ]);
        const file = await download.path();
        expect(statSync(file).size, format).toBeGreaterThan(1000);
      }

      await page.getByRole("button", { name: "Present", exact: true }).click();
      const counter = page.locator(".present-counter");
      await counter.waitFor();
      expect(await counter.textContent()).toBe("Step 1 of 8");
      for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        `document.querySelector(".present-counter")?.textContent === "Step 8 of 8"`,
        undefined,
        { timeout: 10_000 },
      );
      await page.keyboard.press("Escape");
      await page.locator(".present-controls").waitFor({ state: "hidden" });

      if (scratch) {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(scratch, "sequence-dark.png") });
      }
    } finally {
      await context.close();
      await server.close();
    }
  });
});
