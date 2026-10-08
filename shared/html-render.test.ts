import { describe, expect, it } from "vitest";
import {
  RENDER_MAX_HEIGHT,
  RENDER_MIN_HEIGHT,
  RENDER_WIDTHS,
  injectRenderBootstrap,
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
