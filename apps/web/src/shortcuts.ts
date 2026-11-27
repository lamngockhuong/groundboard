/** Where a single-key shortcut must not fire: the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Whether the event comes from the Excalidraw canvas, which has its own single-key tools. */
export function inCanvas(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".excalidraw") !== null;
}

const hasModifier = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey;

/** Apple platforms use Cmd where others use Ctrl. */
export const isApple = (platform: string = navigator.platform): boolean =>
  /Mac|iPhone|iPad/.test(platform);

/** A plain key press (no Ctrl, Cmd or Alt) outside any field and outside the canvas. */
export function isPageKey(event: KeyboardEvent, key: string): boolean {
  return (
    event.key === key &&
    !event.defaultPrevented &&
    !hasModifier(event) &&
    !isTypingTarget(event.target) &&
    !inCanvas(event.target)
  );
}

/** A plain key press outside any field; the canvas is fine, as long as no text is edited there. */
export function isViewerKey(event: KeyboardEvent, key: string): boolean {
  return (
    event.key === key &&
    !event.defaultPrevented &&
    !hasModifier(event) &&
    !isTypingTarget(event.target)
  );
}

/**
 * Ctrl K, or Cmd K on Apple platforms, where Ctrl K stays "delete to the end of the line" in
 * text fields: opens the command palette.
 */
export function isPaletteKey(event: KeyboardEvent, apple: boolean = isApple()): boolean {
  const command = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // Some synthetic key events (autofill) carry no key.
  return command && !event.altKey && !event.shiftKey && (event.key ?? "").toLowerCase() === "k";
}

/** How the palette key is written on this platform: ⌘K on macOS and iOS, Ctrl K elsewhere. */
export function paletteKeyLabel(platform: string = navigator.platform): string {
  return isApple(platform) ? "⌘K" : "Ctrl K";
}

/**
 * Alt ← and Alt → (⌥ on macOS): the viewer's Back and Forward. Not in a field, where Alt and an
 * arrow moves by word on macOS, and not with Ctrl, Cmd or Shift held.
 */
export function isHistoryKey(event: KeyboardEvent): "back" | "forward" | null {
  if (
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.defaultPrevented ||
    isTypingTarget(event.target)
  ) {
    return null;
  }
  return event.key === "ArrowLeft" ? "back" : event.key === "ArrowRight" ? "forward" : null;
}

/**
 * Whether the viewer takes a history key: only while nothing is selected on the canvas. With a
 * selection, Excalidraw may use Alt and an arrow for its flowchart, so the key is left to it.
 */
export function historyKeyWins(event: KeyboardEvent, selectedCount: number): boolean {
  return isHistoryKey(event) !== null && selectedCount === 0;
}

/** A key of the tab bar: Alt and a digit chooses a tab, Alt W closes the one on screen. */
export type TabKey = { type: "select"; n: number } | { type: "close" };

/**
 * Alt 1 to Alt 9 (Alt 9 the last tab) and Alt W, ⌥ on macOS. Read from `event.code`, the key's
 * place on the keyboard: Option on macOS turns `event.key` into another character (⌥1 is
 * "¡"). Not with Ctrl, Cmd or Shift held, and not in a field.
 */
export function isTabKey(event: KeyboardEvent): TabKey | null {
  if (
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.defaultPrevented ||
    isTypingTarget(event.target)
  ) {
    return null;
  }
  const digit = /^Digit([1-9])$/.exec(event.code ?? "");
  if (digit) return { type: "select", n: Number(digit[1]) };
  return event.code === "KeyW" ? { type: "close" } : null;
}

/**
 * Alt and a left click on a board link: opens it in a new tab of the viewer. Ctrl, Cmd and the
 * middle button are left to the browser, which opens a tab of its own.
 */
export function isNewTabClick(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  button: number;
}): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0;
}

/** Ctrl Enter, or Cmd Enter on Apple platforms (as the palette key): open in a new tab. */
export function isNewTabEnter(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  apple: boolean = isApple(),
): boolean {
  const command = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && !event.altKey && !event.shiftKey && event.key === "Enter";
}

/** How the new-tab Enter is written on this platform. */
export function newTabEnterLabel(platform: string = navigator.platform): string {
  return isApple(platform) ? "⌘Enter" : "Ctrl+Enter";
}
