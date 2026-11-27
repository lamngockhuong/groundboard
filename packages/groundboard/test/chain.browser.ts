// From the "Pay" button to the job it starts, in the built viewer: each link across boards opens
// the board that defines its target, on a served atlas and in the list of boards kept in the
// browser. Needs `pnpm -r build` and `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderBoard } from "../src/pipeline.ts";
import { type AppOptions, createApp } from "../src/server/app.ts";
import { openExampleBoards } from "./library-boards.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));
const atlasDir = path.join(fixtures, ".groundboard");

/** Each hop: the board on screen, the tag of the link on it, and where the link leads. */
const CHAIN = [
  {
    from: "web--checkout",
    node: "pay",
    tag: "pay-orders",
    to: "api--orders",
    target: "create-order",
  },
  {
    from: "api--orders",
    node: "create-order",
    tag: "create-writes",
    to: "overview-db",
    target: "orders",
  },
  {
    from: "api--orders",
    node: "create-order",
    tag: "create-enqueues",
    to: "overview-batch",
    target: "send-receipt",
  },
] as const;

async function start(options: AppOptions) {
  const built = createApp({ host: "127.0.0.1", webRoot, ...options });
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

async function waitForBoard(page: Page): Promise<void> {
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

/**
 * Follows each link of the chain the way a reader does: the board opened on the node the link
 * starts from, a double click on the link's numbered tag, and the board it opens selects the
 * target, which the Sources panel names.
 */
async function followChain(page: Page, origin: string): Promise<void> {
  for (const hop of CHAIN) {
    await page.goto(`${origin}/#/board/${hop.from}?node=${hop.node}`);
    await waitForBoard(page);
    const box = await tagBox(page, hop.from, hop.node, hop.tag);
    // The deep link selected the node, whose resize handles may cover the tag: click on empty
    // canvas first, then double-click the tag.
    const canvas = await page.locator(".canvas").boundingBox();
    if (canvas) await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 60);
    await page.mouse.dblclick(box.x, box.y);
    await page.waitForURL(new RegExp(`#/board/${hop.to}`), { timeout: 15_000 });
    await waitForBoard(page);
    // The link opened its board in a new tab of the viewer, beside the one it started from.
    expect(await page.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
    expect(await page.locator(".tab.active.preview").count()).toBe(0);
    expect(await page.locator('[role="tab"]').count()).toBeGreaterThan(1);
    // The target is selected: the Sources panel names its node.
    await page
      .locator(".node-sources .node-id")
      .getByText(hop.target, { exact: true })
      .first()
      .waitFor({ timeout: 15_000 });
  }
}

type SceneElement = { id: string; x: number; y: number; width: number; height: number };

/** The scene of a fixture board, laid out by the same pipeline the viewer runs. */
async function sceneOf(slug: string): Promise<SceneElement[]> {
  const board = JSON.parse(readFileSync(path.join(atlasDir, `${slug}.board.json`), "utf8"));
  const result = await renderBoard(board);
  if (!result.ok || !result.scene) throw new Error(`${slug} did not render`);
  return result.scene.elements as unknown as SceneElement[];
}

/**
 * Where a link's tag is on screen. The canvas draws it, so its place comes from the scene: the
 * deep link put the node at the centre of the canvas at the zoom the zoom button reads, and the
 * tag sits where the scene puts it relative to that node.
 */
async function tagBox(
  page: Page,
  slug: string,
  nodeId: string,
  edgeId: string,
): Promise<{ x: number; y: number }> {
  const elements = await sceneOf(slug);
  const find = (id: string) => {
    const element = elements.find((e) => e.id === id);
    if (!element) throw new Error(`${slug} has no ${id}`);
    return element;
  };
  const centre = (e: SceneElement) => [e.x + e.width / 2, e.y + e.height / 2] as const;
  const [nx, ny] = centre(find(`node/${nodeId}`));
  const [tx, ty] = centre(find(`ref-tag/${edgeId}`));
  const zoomText = await page.locator(".canvas .reset-zoom-button").first().textContent();
  const zoom = Number.parseInt(zoomText ?? "100", 10) / 100;
  const canvas = await page.locator(".canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  return {
    x: canvas.x + canvas.width / 2 + (tx - nx) * zoom,
    y: canvas.y + canvas.height / 2 + (ty - ny) * zoom,
  };
}

describe("from the Pay button to the job it starts", () => {
  test("on a served atlas", async () => {
    const server = await start({ atlas: { dir: atlasDir, root: fixtures } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await followChain(page, server.origin);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("in the list of boards kept in the browser, after opening the atlas as a zip", async () => {
    const server = await start({});
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await openExampleBoards(page, server.origin, atlasDir);
      await followChain(page, server.origin);
    } finally {
      await context.close();
      await server.close();
    }
  });
});
