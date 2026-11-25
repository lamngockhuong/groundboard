// Zips of boards in the built viewer: downloaded from a served atlas, then opened again in the
// library of a server without one, with the page's CSP in force and the work in a worker.
// Needs `pnpm -r build` and `pnpm exec playwright install --only-shell chromium` first.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type AppOptions, createApp } from "../src/server/app.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(packageDir, "dist", "web");
const fixtures = realpathSync(path.resolve(packageDir, "../../examples/fixtures"));
const atlasDir = path.join(fixtures, ".groundboard");
const boardSlugs = readdirSync(atlasDir)
  .filter((name) => name.endsWith(".board.json"))
  .map((name) => name.slice(0, -".board.json".length))
  .sort();

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

/** A page whose CSP violations and page errors are collected. */
async function openPage(origin: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
  await page.goto(origin);
  return { context, page, problems };
}

async function waitForBoard(page: Page): Promise<void> {
  await page.getByText("Loading the board").waitFor({ state: "hidden", timeout: 30_000 });
  await page.locator(".canvas .main-menu-trigger").first().waitFor({ timeout: 30_000 });
}

/** Downloads the zip from the Export menu with one of the two options; returns its files. */
async function downloadZip(page: Page, extras: boolean): Promise<Record<string, Uint8Array>> {
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /Download zip/ }).click();
  await page.getByLabel(extras ? /With rendered scenes/ : /Board files only/).check();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(".zip-dialog").getByRole("button", { name: "Download" }).click(),
  ]);
  const file = await download.path();
  return unzipSync(new Uint8Array(readFileSync(file)));
}

describe("zips of boards", () => {
  test("download from a served atlas, then open again in the library", async () => {
    const atlas = await start({ atlas: { dir: atlasDir, root: fixtures } });
    let plain: Record<string, Uint8Array>;
    try {
      const { context, page, problems } = await openPage(`${atlas.origin}/#/board/web--checkout`);
      await waitForBoard(page);
      plain = await downloadZip(page, false);
      expect(Object.keys(plain).sort()).toEqual(
        boardSlugs.map((slug) => `.groundboard/${slug}.board.json`),
      );
      for (const slug of boardSlugs) {
        expect(strFromU8(plain[`.groundboard/${slug}.board.json`] as Uint8Array)).toBe(
          readFileSync(path.join(atlasDir, `${slug}.board.json`), "utf8"),
        );
      }
      const extras = await downloadZip(page, true);
      for (const slug of boardSlugs) {
        expect(Object.keys(extras)).toContain(`.groundboard/${slug}.excalidraw`);
        // A PNG starts with its signature.
        expect([...(extras[`images/${slug}.png`] as Uint8Array).subarray(1, 4)]).toEqual([
          80, 78, 71,
        ]);
      }
      expect(problems).toEqual([]);
      await context.close();
    } finally {
      await atlas.close();
    }

    const library = await start({});
    try {
      const { context, page, problems } = await openPage(library.origin);
      await waitForBoard(page);
      await page.getByRole("button", { name: "Open file", exact: true }).first().click();
      await page.locator(".file-dialog input[type=file]").setInputFiles({
        name: "atlas.zip",
        mimeType: "application/zip",
        buffer: Buffer.from(zipSync(plain, { level: 6 })),
      });
      const loaded = new RegExp(
        `Loaded ${boardSlugs.length} board\\(s\\) and 0 scene\\(s\\) from atlas\\.zip`,
      );
      await page.getByText(loaded).waitFor({
        timeout: 30_000,
      });
      // The boards stay after a reload: they are in IndexedDB.
      await page.reload();
      for (const slug of boardSlugs) {
        await page
          .locator(`.sidebar a[href="#/board/${slug}"]`)
          .first()
          .waitFor({ timeout: 30_000 });
      }
      expect(problems).toEqual([]);
      await context.close();
    } finally {
      await library.close();
    }
  });
});
