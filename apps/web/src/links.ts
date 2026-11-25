/**
 * Returns the URL to open for an element link, or null when it must not be opened.
 * Only absolute `https:` URLs pass; every other scheme (javascript:, data:, http:) and
 * relative links are refused. The URL is parsed, never pattern-matched, so case and
 * leading whitespace tricks cannot slip a different scheme through.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  let parsed: URL;
  try {
    // No base URL: a relative link throws instead of resolving against the page.
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  return parsed.protocol === "https:" ? parsed.href : null;
}
