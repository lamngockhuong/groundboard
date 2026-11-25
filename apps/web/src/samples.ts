import type { LibraryEntry } from "./library.ts";

/**
 * The sample atlas shown while nothing has been opened: the small shop app of the repository's
 * examples. Loaded only when needed, and never stored.
 */
const files = import.meta.glob<Record<string, unknown>>(
  "../../../examples/fixtures/.groundboard/*.board.json",
  { import: "default" },
);

/** The sample board shown first: the web app's overview. */
export const SAMPLE_START = "overview-web";

export async function loadSamples(): Promise<LibraryEntry[]> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, load]) => ({
      slug: (path.split("/").pop() ?? path).replace(/\.board\.json$/, ""),
      input: { type: "board" as const, board: await load() },
      openedAt: 0,
    })),
  );
  return entries.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}
