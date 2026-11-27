import { missingFlowRefs } from "@groundboard/schema";
import type { AtlasIndex } from "./api.ts";
import { t } from "./i18n.ts";

/**
 * Which elements call an API or change state with no flow drawn for them yet. The source panel,
 * the marks on the canvas and the atlas home all read the same set, so their counts agree, and
 * the set is the one `atlas check` warns about.
 */

const EMPTY: ReadonlySet<string> = new Set();

/** The refs of the atlas that need a flow and have none; empty with no atlas (a pasted board). */
export function missingFlowSet(atlas: AtlasIndex | null): ReadonlySet<string> {
  if (atlas === null) return EMPTY;
  // An invalid board was never read: it neither defines a ref nor covers one.
  const kinds = new Map(
    atlas.boards.filter((b) => b.status !== "invalid").map((b) => [b.slug, b.kind]),
  );
  const missing = missingFlowRefs(atlas.refs, (slug) => kinds.get(slug));
  return missing.length === 0 ? EMPTY : new Set(missing);
}

/** Longest label a prompt quotes; a longer one is cut with an ellipsis. */
const MAX_LABEL = 120;

/** One line of text with no backticks, so it reads cleanly inside the prompt. */
function tidy(text: string): string {
  const flat = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/**
 * The line a reader copies to ask for the missing flow, in the interface language: the board
 * skill, the element's label, the screen it is on and its ref. Always a single line.
 */
export function flowPrompt({
  label,
  screen,
  ref,
}: {
  label?: string;
  screen?: string;
  ref: string;
}): string {
  const name = tidy(label ?? "") || ref;
  const on = tidy(screen ?? "") || ref.split("/")[0] || ref;
  return t("flowHint.prompt", { label: name, screen: on, ref: tidy(ref) });
}

/** Copies text to the clipboard; false when the browser refuses (as a sandboxed frame may). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
