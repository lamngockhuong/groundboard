import { createElement, Fragment, type ReactNode, useSyncExternalStore } from "react";
import { en } from "./locales/en.ts";
import { ja } from "./locales/ja.ts";
import { vi } from "./locales/vi.ts";

/**
 * The viewer's interface language. Only the viewer's own words are translated: board titles,
 * node text, quotes and the messages the server writes stay as they were written.
 */
export type Locale = "en" | "ja" | "vi";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

/** Keys written as `<base>_one` and `<base>_other`, picked by the count. */
type PluralKey = MessageKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;

export const LOCALES: ReadonlyArray<{
  id: Locale;
  /** The language's name in itself, so a reader can find their own in any interface language. */
  label: string;
  /** The code Excalidraw knows the language by, for the editor's own menus. */
  excalidraw: string;
}> = [
  { id: "en", label: "English", excalidraw: "en" },
  { id: "ja", label: "日本語", excalidraw: "ja-JP" },
  { id: "vi", label: "Tiếng Việt", excalidraw: "vi-VN" },
];

const MESSAGES: Record<Locale, Messages> = { en, ja, vi };
const LOCALE_KEY = "groundboard.locale";
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: unknown): value is Locale => LOCALES.some((l) => l.id === value);

/** The first of the browser's languages the viewer speaks, by primary subtag; else English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const primary = language.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** The language the viewer picked, or the browser's when none is stored or storage is blocked. */
export function readLocalePreference(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage is blocked; fall back to the browser's language.
  }
  return detectLocale(browserLanguages());
}

let current: Locale = readLocalePreference();
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

/** Switches the interface language, remembers it, and re-renders every reader of `useLocale`. */
export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
  if (locale === current) return;
  current = locale;
  applyLocale(locale);
  for (const listener of listeners) listener();
}

/** Sets `lang` on <html>, so screen readers and fonts pick the right language. */
export function applyLocale(locale: Locale = current): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current language; the calling component renders again when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

type Params = Readonly<Record<string, string | number>>;

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (all, name: string) => String(params[name] ?? all)) : text;

/** The message in the current language, with `{name}` placeholders filled in. */
export function t(key: MessageKey, params?: Params): string {
  return fill(MESSAGES[current][key] ?? en[key], params);
}

/**
 * A message with React nodes in its `{name}` slots, such as a `<code>` file name, so the
 * translation decides where the node sits in the sentence.
 */
export function tNodes(key: MessageKey, slots: Readonly<Record<string, ReactNode>>): ReactNode[] {
  const text = MESSAGES[current][key] ?? en[key];
  return text.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name !== undefined && name in slots
      ? createElement(Fragment, { key: index }, slots[name])
      : part;
  });
}

/** A message that depends on a count: `<base>_one` or `<base>_other`, with `{count}` filled. */
export function tn(base: PluralKey, count: number, params?: Params): string {
  const rule = new Intl.PluralRules(current).select(count) === "one" ? "one" : "other";
  return t(`${base}_${rule}` as MessageKey, { count, ...params });
}

/** Dates and times in the interface language; the reader's own locale while it is English. */
export const dateLocale = (): string | undefined => (current === "en" ? undefined : current);
