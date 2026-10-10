import { describe, expect, it } from "vitest";
import {
  RENDER_MAX_HEIGHT,
  RENDER_MIN_HEIGHT,
  RENDER_WIDTHS,
  injectRenderBootstrap,
  prependToHead,
  renderHeightAt,
} from "./html-render";

describe("renderHeightAt", () => {
  // Text wraps more as the frame narrows: tallest at the first width.
  const heights = RENDER_WIDTHS.map((w) => 2000 - w);

  it("interpolates between the measured widths and holds past the ends", () => {
    expect(renderHeightAt(heights, 560)).toBe(2000 - 560);
    expect(renderHeightAt(heights, 100)).toBe(2000 - RENDER_WIDTHS[0]);
    expect(renderHeightAt(heights, 4000)).toBe(2000 - RENDER_WIDTHS.at(-1)!);
  });

  it("keeps the frame within its bounds, and has no answer for a page never measured", () => {
    expect(renderHeightAt(RENDER_WIDTHS.map(() => 10), 640)).toBe(
      RENDER_MIN_HEIGHT,
    );
    expect(renderHeightAt(RENDER_WIDTHS.map(() => 9000), 640)).toBe(
      RENDER_MAX_HEIGHT,
    );
    expect(renderHeightAt(undefined, 640)).toBeUndefined();
    expect(renderHeightAt([300, 200], 640)).toBeUndefined();
  });
});

describe("injectRenderBootstrap", () => {
  const scriptAt = (html: string) => html.indexOf("<script>");

  it("runs before the page's own head content", () => {
    const html = injectRenderBootstrap(
      '<!doctype html><html><head lang="en"><script>mine()</script></head></html>',
    );
    expect(scriptAt(html)).toBe(html.indexOf('<head lang="en">') + 16);
    expect(scriptAt(html)).toBeLessThan(html.indexOf("mine()"));
  });

  it("gives a fragment without a head one, after its doctype", () => {
    const html = injectRenderBootstrap("<!DOCTYPE html><table></table>");
    expect(html.startsWith("<!DOCTYPE html><head>")).toBe(true);
    expect(scriptAt(html)).toBeLessThan(html.indexOf("<table>"));
  });
});

describe("prependToHead", () => {
  const tag = "<meta id=first>";

  it("skips a <head> in a comment or an attribute, where the tag would do nothing", () => {
    expect(prependToHead("<!-- <head> --><p>x</p>", tag)).toBe(
      `<!-- <head> --><head><meta charset="utf-8">${tag}</head><p>x</p>`,
    );
    expect(
      prependToHead('<!doctype html><html data-x="<head>"><body>x</body></html>', tag),
    ).toBe(
      `<!doctype html><html data-x="<head>"><head><meta charset="utf-8">${tag}</head><body>x</body></html>`,
    );
    expect(prependToHead('<head data-x="a>b"><title>t</title>', tag)).toBe(
      `<head data-x="a>b">${tag}<title>t</title>`,
    );
  });

  it("goes before whatever the page puts ahead of its own head", () => {
    const html = prependToHead('<img src="https://x/a.png"><head></head>', tag);
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("<img"));
  });

  it("takes an unclosed comment for the rest of the page", () => {
    expect(prependToHead("<!-- <head>", tag)).toBe(
      `<head><meta charset="utf-8">${tag}</head><!-- <head>`,
    );
  });
});
