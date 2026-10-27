import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { providerMarks } from "../../../shared/provider-marks";
import { CursorGlyph } from "./CursorGlyph";
import {
  Amp,
  Antigravity,
  ClaudeAI,
  Meta,
  OpenAI,
  OpenCode,
} from "./ProviderLogos";

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

  it("match the marks the guest page draws", () => {
    const logos = {
      codex: OpenAI,
      claude: ClaudeAI,
      opencode: OpenCode,
      cursor: CursorGlyph,
      muse: Meta,
      amp: Amp,
      antigravity: Antigravity,
    };
    for (const [provider, Logo] of Object.entries(logos))
      expect(renderToStaticMarkup(<Logo />), provider).toBe(
        providerMarks[provider as keyof typeof providerMarks],
      );
  });
});
