// The release viewer opens on an empty list when no atlas is served: it carries no sample
// boards. Browser tests that need boards in the list put the example shop atlas there, as a
// user would, through the "Open file" dialog with a zip of its boards.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { Page } from "playwright";

/** Opens the viewer's home with no atlas, then loads every board of `atlasDir` into the list. */
export async function openExampleBoards(page: Page, origin: string, atlasDir: string) {
  await page.goto(`${origin}/#/`);
  await page.locator(".atlas-home").waitFor({ timeout: 30_000 });
  const files: Record<string, Uint8Array> = {};
  for (const name of readdirSync(atlasDir).filter((n) => n.endsWith(".board.json"))) {
    files[`.groundboard/${name}`] = strToU8(readFileSync(path.join(atlasDir, name), "utf8"));
  }
  await page.getByRole("button", { name: "Open file", exact: true }).first().click();
  await page.locator(".file-dialog input[type=file]").setInputFiles({
    name: "examples.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync(files)),
  });
  await page.getByText(/from examples\.zip/).waitFor({ timeout: 30_000 });
  // A zip of many boards goes back to the list rather than opening one.
  await page.locator(".atlas-home").waitFor({ timeout: 30_000 });
}
