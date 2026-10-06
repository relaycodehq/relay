import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaudeAI, OpenAI, OpenCode } from "./ProviderLogos";

const svgOf = (markup: string) => markup.match(/^<svg[^>]*>/)![0];

describe("provider logos", () => {
  it.each([OpenAI, ClaudeAI, OpenCode])(
    "pass the caller's class through but keep their own viewBox and fill",
    (Logo) => {
      const svg = svgOf(
        renderToStaticMarkup(
          <Logo
            className="provider-glyph"
            aria-hidden
            viewBox="0 0 1 1"
            fill="red"
          />,
        ),
      );
      expect(svg).toContain('class="provider-glyph"');
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toContain('viewBox="0 0 1 1"');
      expect(svg).not.toContain('fill="red"');
      expect(svg).not.toMatch(/\b(width|height)=/);
    },
  );

  it("paints Claude orange and the others in the text colour", () => {
    expect(svgOf(renderToStaticMarkup(<ClaudeAI />))).toContain(
      'fill="#d97757"',
    );
    expect(svgOf(renderToStaticMarkup(<OpenAI />))).toContain(
      'fill="currentColor"',
    );
    expect(svgOf(renderToStaticMarkup(<OpenCode />))).toContain(
      'fill="currentColor"',
    );
  });
});
