import { describe, expect, it } from "vitest";
import { LIGHT_RENDER_THEME } from "../../../../shared/html-render";
import { fontsFor, mathDocument } from "./math-page";

describe("mathDocument", () => {
  it("is a page with the formula as data for KaTeX, under the page rules", () => {
    const page = mathDocument("x^2", LIGHT_RENDER_THEME);
    expect(page).toContain('katex.render("x^2"');
    expect(page).toContain("Content-Security-Policy");
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(
      page.indexOf("katex.render"),
    );
  });

  it("can't be broken out of by a formula", () => {
    const page = mathDocument('"); alert(1) </script><b>', LIGHT_RENDER_THEME);
    expect(page).not.toContain("</script><b>");
    expect(page).toContain("\\u003c/script>");
    // The bootstrap's, KaTeX's and the call's: no fourth one a formula opened.
    expect(page.match(/<script>/g)).toHaveLength(3);
  });
});

describe("fontsFor", () => {
  const faces = (tex: string) =>
    [...fontsFor(tex).matchAll(/font-family:([^;]+)/g)].map((m) => m[1]);

  it("leaves out the alphabets a formula doesn't ask for", () => {
    const plain = faces("\\sum_{i=1}^n \\frac{a_i}{\\sqrt{b}} \\in \\mathbb{R}");
    expect(plain).toContain("KaTeX_Main");
    expect(plain).toContain("KaTeX_AMS");
    expect(plain).not.toContain("KaTeX_Caligraphic");
    expect(fontsFor("x").length).toBeLessThan(200_000);
  });

  it("takes them when one is asked for", () => {
    expect(faces("\\mathcal{L}")).toContain("KaTeX_Caligraphic");
    expect(faces("\\mathtt{x}")).toContain("KaTeX_Typewriter");
  });
});
