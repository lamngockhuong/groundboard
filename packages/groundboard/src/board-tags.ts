import { BoardTagsSchema, parseBoard } from "@groundboard/schema";
import { writeAtlasFile } from "./board-write.ts";

export type TagsWrite =
  | { ok: true; tags: string[]; etag: string }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string; etag?: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The board with `tags` set, every other field kept in its place. A board without tags gets
 * them right after `question`, where the IR guide lists them; no tags removes the field.
 */
export function withTags(board: Record<string, unknown>, tags: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const place = "tags" in board ? "tags" : "question" in board ? "question" : null;
  for (const [key, value] of Object.entries(board)) {
    if (key === "tags") {
      if (tags.length > 0) out.tags = tags;
      continue;
    }
    out[key] = value;
    if (key === place && tags.length > 0) out.tags = tags;
  }
  if (place === null && tags.length > 0) out.tags = tags;
  return out;
}

/**
 * Replaces the tags of the board `<slug>.board.json` directly in `dir` (a real path the caller
 * confined). Only `tags` changes; the file must be a valid board before and after. Written
 * through `writeAtlasFile`: under the board's lock, compared with `expectedEtag` when given,
 * and renamed over the old file.
 */
export async function writeBoardTags(
  dir: string,
  slug: string,
  input: unknown,
  expectedEtag?: string | null,
): Promise<TagsWrite> {
  const parsedTags = BoardTagsSchema.safeParse(input);
  if (!parsedTags.success) {
    const issue = parsedTags.error.issues[0];
    return { ok: false, status: 422, error: issue ? issue.message : "invalid tags" };
  }
  const tags = parsedTags.data;
  const written = await writeAtlasFile(
    dir,
    slug,
    "board",
    (current) => {
      let json: unknown;
      try {
        json = JSON.parse(current ?? "");
      } catch {
        return { ok: false, status: 409, error: "the board file is not valid JSON" };
      }
      if (!isRecord(json) || !parseBoard(json).ok) {
        return { ok: false, status: 409, error: "the board is invalid; fix it before tagging it" };
      }
      const next = withTags(json, tags);
      if (!parseBoard(next).ok) return { ok: false, status: 422, error: "invalid tags" };
      return { ok: true, text: `${JSON.stringify(next, null, 2)}\n` };
    },
    expectedEtag,
  );
  if (!written.ok) {
    return {
      ok: false,
      status: written.status === 413 ? 422 : written.status,
      error: written.error,
      ...(written.etag !== undefined ? { etag: written.etag } : {}),
    };
  }
  return { ok: true, tags, etag: written.etag };
}
