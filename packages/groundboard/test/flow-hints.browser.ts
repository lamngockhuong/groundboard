// Missing-flow hints in the built viewer: marks on the elements that call an API or change state
// with no flow yet, the "No flow yet" line with its request to copy in the source panel, the
// Layers entry that hides the marks, and the count with its list on the atlas home. Checked on
// `groundboard serve` and on a static `groundboard export`. Needs `pnpm -r build` and
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

/*
 * The states fixture: web--users-upload has eight elements whose transitions no flow covers,
 * among them the Import button (`confirm-import`, ref `web:users-upload/import`). The main
 * fixture's checkout has none: Pay is covered by the place-order flow, Back only navigates.
 */
const STATES = path.join(fixtures, "states");
const SCREEN = "web--users-upload";
const MISSING = 8;
const IMPORT_NODE = "confirm-import";
const IMPORT_REF = "web:users-upload/import";

interface Running {
  origin: string;
  close: () => Promise<void>;
}

async function startServe(root: string): Promise<Running> {
  const dir = path.join(root, ".groundboard");
  const built = createApp({ host: "127.0.0.1", webRoot, atlas: { dir, root } });
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
  exported = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-flow-hints-")));
  await exportAtlas(
    { dir: path.join(STATES, ".groundboard"), root: STATES, out: exported, webRoot },
    () => {},
  );
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

const marks = (page: Page) => page.locator(".flow-hint-overlay .flow-hint-mark");

interface Seen {
  marks: number;
  copied: string;
  marksLayerOff: number;
  marksPresenting: number;
  homeCount: string;
  listedUrl: string;
  errors: string[];
}

async function walk(origin: string): Promise<Seen> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));

    await page.goto(`${origin}/#/board/${SCREEN}`);
    await waitForBoard(page);
    await marks(page).first().waitFor({ timeout: 10_000 });
    const markCount = await marks(page).count();

    await page.goto(`${origin}/#/board/${SCREEN}?node=${IMPORT_NODE}`);
    await waitForBoard(page);
    const hint = page.locator(".source-panel .flow-hint");
    await hint.waitFor({ timeout: 10_000 });
    await hint.getByRole("button", { name: "Copy the request for a developer" }).click();
    await hint.getByText("Copied").waitFor();
    // A string, run in the page: this package is typed without the DOM.
    const copied = String(await page.evaluate("navigator.clipboard.readText()"));

    await page.getByRole("button", { name: /^Layers/ }).click();
    await page.getByRole("menuitemcheckbox", { name: /Flow hints/ }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const marksLayerOff = await marks(page).count();
    await page.getByRole("button", { name: /^Layers/ }).click();
    await page.getByRole("menuitemcheckbox", { name: /Flow hints/ }).click();
    await page.keyboard.press("Escape");
    await marks(page).first().waitFor({ timeout: 10_000 });

    await page.getByRole("button", { name: "Present", exact: true }).click();
    await page.locator(".present-controls").waitFor();
    await page.waitForTimeout(300);
    const marksPresenting = await marks(page).count();
    await page.keyboard.press("Escape");
    await page.locator(".present-controls").waitFor({ state: "hidden" });

    await page.goto(`${origin}/#/`);
    const stat = page.locator(".stat-button");
    await stat.waitFor({ timeout: 10_000 });
    const homeCount = (await stat.locator(".stat-value").textContent()) ?? "";
    await stat.click();
    await page.locator(".missing-flows[open]").waitFor();
    await page.locator(".missing-flows").getByRole("link", { name: IMPORT_REF }).click();
    await waitForBoard(page);
    const listedUrl = page.url();
    await page.locator(".source-panel .flow-hint").waitFor({ timeout: 10_000 });

    return {
      marks: markCount,
      copied,
      marksLayerOff,
      marksPresenting,
      homeCount,
      listedUrl,
      errors,
    };
  } finally {
    await context.close();
  }
}

function expectHints(seen: Seen) {
  expect(seen).toMatchObject({
    marks: MISSING,
    marksLayerOff: 0,
    marksPresenting: 0,
    homeCount: String(MISSING),
    errors: [],
  });
  expect(seen.copied).toMatch(/^\/groundboard:board Draw the flow when .+ is pressed on .+/);
  expect(seen.copied).toContain(`(\`${IMPORT_REF}\`)`);
  expect(seen.listedUrl).toContain(`#/board/${SCREEN}?node=${IMPORT_NODE}`);
}

describe("missing-flow hints", () => {
  test("mark, explain and list the elements with no flow on groundboard serve", async () => {
    const server = await startServe(STATES);
    try {
      expectHints(await walk(server.origin));
    } finally {
      await server.close();
    }
  });

  test("do the same on a static export", async () => {
    const server = await startStatic(exported);
    try {
      expectHints(await walk(server.origin));
    } finally {
      await server.close();
    }
  });

  test("show nothing where every element that needs a flow has one", async () => {
    const server = await startServe(fixtures);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--checkout?node=pay`);
      await waitForBoard(page);
      await page.locator(".source-panel .node-sources").first().waitFor();
      expect(await marks(page).count()).toBe(0);
      expect(await page.locator(".source-panel .flow-hint").count()).toBe(0);
      await page.goto(`${server.origin}/#/`);
      await page.locator(".atlas-home .stats").waitFor();
      expect(await page.locator(".stat-button").count()).toBe(0);
      expect(await page.locator(".missing-flows").count()).toBe(0);
    } finally {
      await context.close();
      await server.close();
    }
  });
});
