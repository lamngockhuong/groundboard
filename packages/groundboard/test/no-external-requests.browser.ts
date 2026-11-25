// The viewer `groundboard serve` hands out must not reach anything off this machine: no request
// to another origin, no attempt the page's CSP has to block, and no link in the canvas UI that
// leads elsewhere. Runs the built viewer in Chromium against an in-process server.
// Needs `pnpm -r build` and `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type AppOptions, createApp } from "../src/server/app.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));

interface Running {
  origin: string;
  close: () => Promise<void>;
}

async function start(options: AppOptions): Promise<Running> {
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

/** Everything the page tried to reach off its own origin, and every CSP violation it logged. */
interface Watch {
  external: string[];
  violations: string[];
}

async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watch> {
  const seen: Watch = { external: [], violations: [] };
  // Nothing leaves even if the test fails: every request off the origin is recorded and refused.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || /^(data|blob):/.test(url)) return route.continue();
    seen.external.push(url);
    return route.abort("blockedbyclient");
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) {
      seen.violations.push(message.text());
    }
  });
  return seen;
}

/** Links in the viewer that point off the origin; the board's own content has none here. */
const externalLinks = async (page: Page, origin: string): Promise<string[]> => {
  const hrefs = await page
    .locator("a[href]:visible")
    .evaluateAll((links) => links.map((a) => (a as unknown as { href: string }).href));
  return hrefs.filter((href) => /^https?:/.test(href) && !href.startsWith(origin));
};

/** Excalidraw's menu as the viewer offers it; opening, saving and clearing the scene are off. */
const MENU_ITEMS = ["Export image...", "Find on canvas", "Help"];

/**
 * Opens Excalidraw's menu, its dialogs and the help, collecting any external link shown, and
 * anything else that differs from what the viewer means to offer.
 */
async function walkCanvasUi(page: Page, origin: string): Promise<string[]> {
  const found: string[] = [];
  const menu = page.locator(".main-menu-trigger").first();
  await menu.click();
  found.push(...(await externalLinks(page, origin)));
  const items = (await page.locator(".dropdown-menu .dropdown-menu-item").allTextContents())
    .map((text) => text.replace(/\s+/g, " ").trim())
    .map((text) => MENU_ITEMS.find((item) => text.startsWith(item)) ?? text);
  if (items.join("|") !== MENU_ITEMS.join("|")) found.push(`menu items: ${items.join(", ")}`);
  for (const item of ["Export image...", "Help"]) {
    if (!(await page.locator(".dropdown-menu").isVisible())) await menu.click();
    await page.locator(".dropdown-menu").getByText(item, { exact: true }).click();
    await page.waitForTimeout(300);
    found.push(...(await externalLinks(page, origin)));
    await page.keyboard.press("Escape");
  }
  // The library panel leads to excalidraw.com once opened; its button must not be offered.
  if ((await page.locator(".default-sidebar-trigger:visible").count()) > 0) {
    found.push("library panel button is visible");
  }
  return found;
}

async function waitForBoard(page: Page): Promise<void> {
  // The previous board stays on screen while the next one loads.
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
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

/** Runs `check` against a fresh server and browser context, closing both whatever happens. */
async function withViewer(
  options: AppOptions,
  check: (page: Page, origin: string) => Promise<string[]>,
): Promise<Watch & { links: string[] }> {
  const server = await start(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const seen = await watch(context, page, server.origin);
    await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
    const links = await check(page, server.origin);
    return { ...seen, links };
  } finally {
    await context.close();
    await server.close();
  }
}

describe("the served viewer reaches nothing off this machine", () => {
  test("with an atlas, boards rendered by the server", async () => {
    const atlas = { dir: path.join(fixtures, ".groundboard"), root: fixtures };
    const result = await withViewer({ atlas }, async (page, origin) => {
      const links: string[] = [];
      for (const slug of ["overview-web", "web--checkout", "place-order"]) {
        await page.goto(`${origin}/#/board/${slug}`);
        await waitForBoard(page);
        links.push(...(await externalLinks(page, origin)));
      }
      links.push(...(await walkCanvasUi(page, origin)));
      return links;
    });
    expect(result).toEqual({ external: [], violations: [], links: [] });
  });

  test("without an atlas, sample boards rendered in the browser one after another", async () => {
    const result = await withViewer({}, async (page, origin) => {
      // Several boards in a row also exercise the shared render worker past its first layout.
      for (const slug of ["overview-web", "web--checkout", "mobile--cart"]) {
        await page.goto(`${origin}/#/board/${slug}`);
        await waitForBoard(page);
      }
      return walkCanvasUi(page, origin);
    });
    expect(result).toEqual({ external: [], violations: [], links: [] });
  });
});
