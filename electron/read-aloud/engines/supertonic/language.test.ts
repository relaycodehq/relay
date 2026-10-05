import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

describe("language", () => {
  it.each([
    ["I found the bug in turn-run.ts and fixed it.", "en"],
    ["Done.", "en"],
    ["Ahoj, všetko je hotové a testy prechádzajú.", "sk"],
    ["Ahoj, všechno je hotové a testy procházejí.", "cs"],
    ["Môžeš to skúsiť ešte raz?", "sk"],
    ["Zkus to ještě jednou, prosím, přes víkend.", "cs"],
    ["Wszystko jest gotowe, testy przechodzą.", "pl"],
    ["Das ist nicht fertig, aber die Tests laufen.", "de"],
    ["Привет, всё готово.", "ru"],
    ["Привіт, усе готово, їжак.", "uk"],
    ["Здравей, всичко е готово и тестовете минават, ъгъл.", "bg"],
    ["Γεια σου, όλα έτοιμα.", "el"],
    ["모든 테스트가 통과했습니다.", "ko"],
    ["テストはすべて通りました。", "ja"],
    ["所有测试都通过了。", "na"],
    ["Café olé", "na"],
  ] as const)("reads %j as %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});
