import { describe, expect, it } from "vitest";
import { guestHtml, type GuestLinks } from "./markdown";

const none: GuestLinks = { media: () => undefined, file: () => undefined };

describe("guestHtml", () => {
  it("shows raw HTML and script as text, never as markup", () => {
    const html = guestHtml(
      '<img src=x onerror="alert(1)"> and <script>alert(2)</script>',
      none,
    );
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps links to the web and drops javascript: ones", () => {
    const html = guestHtml(
      "[docs](https://example.com) [bad](javascript:alert(1))",
      none,
    );
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(html).not.toContain("javascript:");
  });

  it("follows reference-style links to their definitions", () => {
    const html = guestHtml(
      "Get the [report][r] or ![chart][c].\n\n[r]: https://example.com/r\n[c]: https://example.com/c.png",
      none,
    );
    expect(html).toContain('<a href="https://example.com/r"');
    expect(html).toContain('<a href="https://example.com/c.png"');
    expect(html).toContain(">chart</a>");
  });

  it("doesn't load remote pictures, so opening the page calls no other server", () => {
    const html = guestHtml("![tracker](https://evil.example/pixel.png)", none);
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://evil.example/pixel.png"');
  });

  it("points local pictures, videos and shared files at the link's own routes", () => {
    const links: GuestLinks = {
      media: (src) =>
        src.endsWith(".mp4")
          ? { id: "vid1", kind: "video" }
          : src.endsWith(".png")
            ? { id: "img1", kind: "image" }
            : undefined,
      file: (href) => (href === "src/app.ts" ? "file1" : undefined),
    };
    const html = guestHtml(
      "![shot](/tmp/shot.png) ![demo](/tmp/demo.mp4) [app](src/app.ts) [secret](/Users/me/.env)",
      links,
    );
    expect(html).toContain('<img data-media="img1" alt="shot">');
    expect(html).toContain('<video data-media="vid1"');
    expect(html).toContain('<a href="#file=file1" data-file="file1">app</a>');
    expect(html).toContain('<span class="local-link">secret</span>');
  });

  it("renders code blocks, tables and task lists", () => {
    const html = guestHtml(
      "```ts\nconst a = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
      none,
    );
    expect(html).toContain(
      '<pre><code data-lang="ts">const a = 1 &lt; 2;</code></pre>',
    );
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('<input type="checkbox" disabled checked>');
  });
});
