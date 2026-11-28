// Missing-flow hints in the built viewer: marks on the elements that call an API or change state
// with no flow yet, the "No flow yet" line with its request to copy in the source panel, the
// Layers entry that hides the marks, and the count with its list on the atlas home (one closed
// group per screen board, open when it is the only one; each element named by its role and
// label, its short ref after them, or by the ref alone in an index without labels). Checked on `groundboard serve` and on a
// static `groundboard export`. Needs `pnpm -r build` and
// `pnpm exec playwright install --only-shell chromium` first.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
/** The list line's accessible name: the role tag, the button's text, then its short ref. */
const IMPORT_NAME = "Button Import import";

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
  groupsOpen: number;
  listedLabel: string;
  listedRole: string;
  listedRef: string;
  listedTitle: string | null;
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
    // The only screen board with missing flows: its group starts open.
    const groupsOpen = await page.locator(".missing-flows-board[open]").count();
    const listed = page
      .locator(".missing-flows")
      .getByRole("link", { name: IMPORT_NAME, exact: true });
    const listedLabel = (await listed.locator(".missing-flows-label").textContent()) ?? "";
    const listedRole = (await listed.locator(".missing-flows-role").textContent()) ?? "";
    const listedRef = (await listed.locator(".missing-flows-ref").textContent()) ?? "";
    const listedTitle = await listed.getAttribute("title");
    await listed.click();
    await waitForBoard(page);
    const listedUrl = page.url();
    await page.locator(".source-panel .flow-hint").waitFor({ timeout: 10_000 });

    return {
      marks: markCount,
      copied,
      marksLayerOff,
      marksPresenting,
      homeCount,
      groupsOpen,
      listedLabel,
      listedRole,
      listedRef,
      listedTitle,
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
    groupsOpen: 1,
    // The line names the button as a reader sees it; the ref follows without the screen part
    // the group already names, and the full ref stays in the link's title.
    listedLabel: "Import",
    listedRole: "Button",
    listedRef: "import",
    listedTitle: IMPORT_REF,
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

  test("count a shared layout's element once and mark it on every screen that carries it", async () => {
    // The layouts fixture: web--cart and web--orders list `web:layout` and carry its Log out
    // button (`web:layout/header-logout`), which calls an API and has no flow yet.
    const server = await startServe(path.join(fixtures, "layouts"));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/web--cart?node=logout`);
      await waitForBoard(page);
      await marks(page).first().waitFor({ timeout: 10_000 });
      expect(await marks(page).count()).toBe(1);
      const panel = page.locator(".source-panel");
      await panel.locator(".flow-hint").waitFor({ timeout: 10_000 });
      // The screen's copy points at the layout's button rather than defining it.
      expect(await panel.locator(".target-ref").textContent()).toBe("web:layout/header-logout");
      expect(await panel.locator(".target-title").textContent()).toBe("Shared layout");
      expect(await panel.locator(".appearances > summary").textContent()).toContain(
        "Other boards with this target",
      );

      await page.goto(`${server.origin}/#/board/web--layout?node=logout`);
      await waitForBoard(page);
      await panel.locator(".flow-hint").waitFor({ timeout: 10_000 });
      expect(await panel.locator(".target-ref").count()).toBe(0);
      expect(await panel.locator(".appearances > summary").textContent()).toContain(
        "Boards that link here",
      );

      await page.goto(`${server.origin}/#/`);
      const stat = page.locator(".stat-button");
      await stat.waitFor({ timeout: 10_000 });
      expect(await stat.locator(".stat-value").textContent()).toBe("1");
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("list several screen boards as closed groups that open to their elements", async () => {
    // The layouts fixture plus the states fixture's upload screen: two screen boards with
    // missing flows, the shared layout (one) and the upload screen (eight).
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-flow-groups-")));
    cpSync(path.join(fixtures, "layouts"), root, { recursive: true });
    cpSync(path.join(STATES, "src"), path.join(root, "src"), { recursive: true });
    cpSync(
      path.join(STATES, ".groundboard", `${SCREEN}.board.json`),
      path.join(root, ".groundboard", `${SCREEN}.board.json`),
    );
    const server = await startServe(root);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/`);
      const stat = page.locator(".stat-button");
      await stat.waitFor({ timeout: 10_000 });
      expect(await stat.locator(".stat-value").textContent()).toBe(String(MISSING + 1));
      await stat.click();
      await page.locator(".missing-flows[open]").waitFor();
      // The Stat button lands on the card's own summary.
      expect(
        await page.evaluate(
          "document.activeElement?.parentElement?.classList.contains('missing-flows') ?? false",
        ),
      ).toBe(true);

      const groups = page.locator(".missing-flows-board");
      expect(await groups.count()).toBe(2);
      expect(await page.locator(".missing-flows-board[open]").count()).toBe(0);
      const upload = page.locator(".missing-flows-group").filter({
        has: page.locator(".missing-flows-open[href$='#/board/web--users-upload']"),
      });
      expect(await upload.locator("summary .count").textContent()).toBe(String(MISSING));
      const listed = upload.getByRole("link", { name: IMPORT_NAME, exact: true });
      expect(await listed.isVisible()).toBe(false);

      // The board link works while the group is closed.
      const open = upload.getByRole("link", { name: /^Open board: / });
      expect(await open.isVisible()).toBe(true);

      await upload.locator("summary").click();
      await listed.waitFor();
      expect(await listed.locator(".missing-flows-label").textContent()).toBe("Import");
      expect(await listed.locator(".missing-flows-ref").textContent()).toBe("import");
      expect(await listed.getAttribute("title")).toBe(IMPORT_REF);
      const layout = page.locator(".missing-flows-group").filter({
        has: page.locator(".missing-flows-open[href$='#/board/web--layout']"),
      });
      expect(await layout.locator(".missing-flows-board[open]").count()).toBe(0);

      await listed.click();
      await waitForBoard(page);
      expect(page.url()).toContain(`#/board/${SCREEN}?node=${IMPORT_NODE}`);
      await page.locator(".source-panel .flow-hint").waitFor({ timeout: 10_000 });
    } finally {
      await context.close();
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fall back to the ref on an older export, and wrap a long label on a phone", async () => {
    // A copy of the export whose index carries no label or role, as one written before they
    // were carried, except for the Import button, which gets a label too long for one line.
    const older = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-flow-older-")));
    cpSync(exported, older, { recursive: true });
    const file = path.join(older, "data", "atlas.json");
    const index = JSON.parse(readFileSync(file, "utf8")) as {
      refs: Array<{ ref: string; definedIn: Array<Record<string, unknown>> }>;
    };
    const long = `Import every user listed in the uploaded file ${"and notify them ".repeat(6)}`;
    for (const entry of index.refs) {
      for (const place of entry.definedIn) {
        delete place.label;
        delete place.role;
        if (entry.ref === IMPORT_REF) place.label = long;
      }
    }
    writeFileSync(file, JSON.stringify(index));
    const server = await startStatic(older);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/`);
      const stat = page.locator(".stat-button");
      await stat.waitFor({ timeout: 10_000 });
      expect(await stat.locator(".stat-value").textContent()).toBe(String(MISSING));
      await stat.click();
      await page.locator(".missing-flows[open]").waitFor();

      const pick = page.locator(".missing-flows li a[href$='node=pick']");
      expect(await pick.locator(".missing-flows-label").textContent()).toBe("choose-file");
      expect(await pick.locator(".missing-flows-role").count()).toBe(0);
      expect(await pick.locator(".missing-flows-ref").count()).toBe(0);
      expect(await pick.getAttribute("title")).toBe("web:users-upload/choose-file");

      const item = page.getByRole("link", { name: `${long.trim()} import`, exact: true });
      const box = await item.locator(".missing-flows-label").boundingBox();
      const line = await page.locator(".missing-flows-ref").first().boundingBox();
      // The label wraps over several lines rather than pushing the page sideways.
      expect(box?.height ?? 0).toBeGreaterThan((line?.height ?? 0) * 2);
      expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
        true,
      );

      await pick.click();
      await waitForBoard(page);
      expect(page.url()).toContain(`?node=pick`);
      await page.locator(".source-panel .flow-hint").waitFor({ timeout: 10_000 });
    } finally {
      await context.close();
      await server.close();
      rmSync(older, { recursive: true, force: true });
    }
  });

  test("hint at an endpoint whose handler has logic, until a flow node carries its ref", async () => {
    // The main fixture with its POST /orders endpoint said to need a sequence and its sequence
    // board left out: nothing explains it, since the Pay button only calls it by toRef.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-endpoint-hints-")));
    cpSync(fixtures, root, { recursive: true });
    // Without the sample's sequence of the handler, whose participant explains the endpoint.
    rmSync(path.join(root, ".groundboard", "place-order-handler.board.json"));
    const apiFile = path.join(root, ".groundboard", "api--orders.board.json");
    const api = JSON.parse(readFileSync(apiFile, "utf8")) as {
      nodes: Array<Record<string, unknown>>;
    };
    const post = api.nodes.find((n) => n.id === "create-order") as Record<string, unknown>;
    post.handler = { shape: "sequence", sourceIds: ["enqueue-receipt"] };
    writeFileSync(apiFile, JSON.stringify(api));
    const server = await startServe(root);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: server.origin,
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("groundboard.locale", "en"));
      await page.goto(`${server.origin}/#/board/api--orders?node=create-order`);
      await waitForBoard(page);
      await marks(page).first().waitFor({ timeout: 10_000 });
      expect(await marks(page).count()).toBe(1);
      const hint = page.locator(".source-panel .flow-hint");
      await hint.waitFor({ timeout: 10_000 });
      expect(await hint.locator(".flow-hint-explain").textContent()).toContain(
        "The handler of this endpoint has logic",
      );
      await hint.getByRole("button", { name: "Copy the request for a developer" }).click();
      await hint.getByText("Copied").waitFor();
      const copied = String(await page.evaluate("navigator.clipboard.readText()"));
      expect(copied).toBe(
        "/groundboard:board Draw a sequence diagram of what POST /api/orders (Place an order) does in its handler, the participant for the handler carrying ref `api:orders/post`, and cite the handler",
      );

      await page.goto(`${server.origin}/#/`);
      const stat = page.locator(".stat-button");
      await stat.waitFor({ timeout: 10_000 });
      expect(await stat.locator(".stat-value").textContent()).toBe("1");
      await stat.click();
      await page.locator(".missing-flows[open]").waitFor();
      expect(await page.locator(".missing-flows-title").textContent()).toBe(
        "1 endpoint with no flow",
      );
      const listed = page
        .locator(".missing-flows")
        .getByRole("link", { name: "API endpoint Place an order post", exact: true });
      await listed.click();
      await waitForBoard(page);
      expect(page.url()).toContain("#/board/api--orders?node=create-order");
      await hint.waitFor({ timeout: 10_000 });

      // A flow whose first step carries the endpoint's ref explains it: every hint goes.
      writeFileSync(
        path.join(root, ".groundboard", "place-order-handler.board.json"),
        JSON.stringify({
          schemaVersion: 1,
          title: "Placing an order",
          question: "What does POST /api/orders do?",
          nodes: [
            {
              id: "in",
              kind: "step",
              label: "Stores the order",
              ref: "api:orders/post",
              sourceIds: ["insert"],
            },
          ],
          sources: [
            {
              id: "insert",
              path: "server/orders-routes.ts",
              line: 15,
              quote: 'const order = await db.insert("orders"',
            },
          ],
        }),
      );
      // A new board is read when the viewer loads the atlas again.
      await page.goto(`${server.origin}/#/`);
      await page.reload();
      await page.locator(".atlas-home .stats").waitFor();
      expect(await page.locator(".stat-button").count()).toBe(0);
      await page.goto(`${server.origin}/#/board/api--orders?node=create-order`);
      await waitForBoard(page);
      await page.locator(".source-panel .node-sources").first().waitFor();
      expect(await marks(page).count()).toBe(0);
      expect(await page.locator(".source-panel .flow-hint").count()).toBe(0);
    } finally {
      await context.close();
      await server.close();
      rmSync(root, { recursive: true, force: true });
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
