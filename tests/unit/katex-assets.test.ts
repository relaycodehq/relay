import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  katexCss,
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
    expect(katexCss).toContain("data:font/woff2;base64,");
    expect(katexCss).not.toMatch(/url\((?!data:)/);
    // Inlined into a <script>, this would end the page's own.
    expect(katexJs).not.toMatch(/<\/script/i);
  });
});
