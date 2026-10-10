import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  katexCss,
  katexFonts,
  katexJs,
  katexVersion,
} from "../../mobile/src/ui/math/katex-assets";

describe("katex assets", () => {
  it("are built from the katex the repository depends on", () => {
    const { dependencies } = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    // Run scripts/build-katex-assets.mjs after changing it.
    expect(katexVersion).toBe(dependencies.katex);
  });

  it("carry fonts inside and nothing that would be fetched", () => {
    // Faces sit apart from the CSS, so a page carries only the ones it uses.
    const faces = Object.values(katexFonts);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toContain("data:font/woff2;base64,");
    for (const css of [katexCss, ...faces])
      expect(css).not.toMatch(/url\((?!data:)/);
    // Inlined into a <script>, this would end the page's own.
    expect(katexJs).not.toMatch(/<\/script/i);
  });
});
