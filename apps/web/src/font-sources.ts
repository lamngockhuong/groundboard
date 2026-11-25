/**
 * Excalidraw gives every font face a `src` list of the page's own copy followed by an esm.sh
 * fallback. The browser checks each listed URL against the page's CSP (`font-src 'self'`), so
 * the fallback logs a violation per face even though the local copy loads. These helpers drop
 * the CDN entry whenever another source remains, so no CDN is listed or contacted.
 */

const CDN_PREFIX = "https://esm.sh/";

/** Splits a CSS `src` descriptor on the commas between entries, not those inside `url(...)`. */
function splitSources(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(src.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

const isCdnSource = (entry: string): boolean => /^url\(\s*["']?https:\/\/esm\.sh\//.test(entry);

/**
 * The `src` descriptor without its esm.sh entries, unless those are all it has: a family the
 * viewer does not ship keeps its CDN source rather than becoming a face with nothing to load.
 */
export function withoutCdnSources(src: string): string {
  if (!src.includes(CDN_PREFIX)) return src;
  const entries = splitSources(src);
  const local = entries.filter((e) => !isCdnSource(e));
  return local.length > 0 && local.length < entries.length ? local.join(", ") : src;
}

/** Wraps `window.FontFace` so string sources pass through `withoutCdnSources`. Idempotent. */
export function installFontSourceFilter(target: { FontFace?: typeof FontFace } = window): void {
  const Original = target.FontFace;
  if (!Original || (Original as { cdnFiltered?: boolean }).cdnFiltered) return;
  const filtered = function fontFace(
    family: string,
    source: string | BufferSource,
    descriptors?: FontFaceDescriptors,
  ) {
    const src = typeof source === "string" ? withoutCdnSources(source) : source;
    return new Original(family, src, descriptors);
  };
  const Filtered = filtered as unknown as typeof FontFace;
  Filtered.prototype = Original.prototype;
  Object.defineProperty(Filtered, "cdnFiltered", { value: true });
  target.FontFace = Filtered;
}
