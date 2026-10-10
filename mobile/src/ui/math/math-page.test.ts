import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIGHT_RENDER_THEME } from "../../../../shared/html-render";
import { katexCss, katexJs, katexVersion } from "./katex-assets";
import { mathDocument } from "./math-page";

describe("katex assets", () => {
  it("are built from the katex the repository depends on", () => {
    const { dependencies } = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
    );
    // Run scripts/build-katex-assets.mjs after changing it.
    expect(katexVersion).toBe(dependencies.katex);
  });

  it("carry fonts inside and nothing that would be fetched", () => {
    expect(katexCss).toContain("data:font/woff2;base64,");
    expect(katexCss).not.toMatch(/url\((?!data:)/);
    // Inlined into a <script>, this would end the page's own.
    expect(katexJs).not.toMatch(/<\/script/i);
  });
});

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
