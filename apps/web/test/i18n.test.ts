import { afterEach, describe, expect, it } from "vitest";
import { detectLocale, getLocale, LOCALES, setLocale, t, tn } from "../src/i18n.ts";
import { en } from "../src/locales/en.ts";
import { ja } from "../src/locales/ja.ts";
import { vi } from "../src/locales/vi.ts";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale("en"));

describe("messages", () => {
  it.each([
    ["ja", ja],
    ["vi", vi],
  ])("%s has every English key, with the same placeholders, and no other key", (_id, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(messages[key as keyof typeof en]), key).toEqual(placeholders(text));
      expect(messages[key as keyof typeof en].trim(), key).not.toBe("");
    }
  });

  it("offers each language under its own name", () => {
    expect(LOCALES.map((l) => l.label)).toEqual(["English", "日本語", "Tiếng Việt"]);
  });
});

describe("detectLocale", () => {
  it("takes the first browser language the viewer speaks, by its primary subtag", () => {
    expect(detectLocale(["ja-JP", "en-US"])).toBe("ja");
    expect(detectLocale(["fr-FR", "vi-VN", "ja"])).toBe("vi");
    expect(detectLocale(["EN-gb"])).toBe("en");
  });

  it("falls back to English", () => {
    expect(detectLocale(["fr-FR", "de"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("t and tn", () => {
  it("fill placeholders and leave unknown ones as written", () => {
    expect(t("atlas.boardMissing", { slug: "web--cart" })).toBe(
      "There is no board named web--cart.",
    );
    expect(t("atlas.boardMissing")).toBe("There is no board named {slug}.");
  });

  it("pick the plural form English needs, and the one form Japanese and Vietnamese have", () => {
    expect(tn("issues.title", 1)).toBe("The board has 1 issue");
    expect(tn("issues.title", 3)).toBe("The board has 3 issues");
    setLocale("vi");
    expect(tn("issues.title", 1)).toBe("Board có 1 lỗi");
    setLocale("ja");
    expect(tn("issues.title", 3)).toBe("ボードに問題が 3 件あります");
  });

  it("switch language, remember it and set <html lang>", () => {
    setLocale("vi");
    expect(getLocale()).toBe("vi");
    expect(localStorage.getItem("groundboard.locale")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
    expect(t("common.close")).toBe("Đóng");
  });
});
