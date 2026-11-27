import type { LibraryEntry } from "./library.ts";

/**
 * The sample atlas shown while nothing has been opened: the small shop app of the repository's
 * examples, with the layout overlays drawn beside its boards. Loaded only when needed, and
 * never stored.
 */
const files = import.meta.glob<Record<string, unknown>>(
  "../../../examples/fixtures/.groundboard/*.board.json",
  { import: "default" },
);
const overlays = import.meta.glob<unknown>(
  "../../../examples/fixtures/.groundboard/*.overlay.json",
  { import: "default" },
);

/** The sample board shown first: the web app's overview. */
export const SAMPLE_START = "overview-web";

const slugOf = (path: string, suffix: RegExp) =>
  (path.split("/").pop() ?? path).replace(suffix, "");

export async function loadSamples(): Promise<LibraryEntry[]> {
  const overlayBySlug = new Map(
    await Promise.all(
      Object.entries(overlays).map(
        async ([path, load]) => [slugOf(path, /\.overlay\.json$/), await load()] as const,
      ),
    ),
  );
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, load]) => {
      const slug = slugOf(path, /\.board\.json$/);
      const overlay = overlayBySlug.get(slug);
      return {
        slug,
        input: { type: "board" as const, board: await load() },
        openedAt: 0,
        ...(overlay === undefined ? {} : { overlay }),
      };
    }),
  );
  return entries.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}
