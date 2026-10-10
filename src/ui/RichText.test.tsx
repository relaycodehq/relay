import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "./RichText";

const render = (text: string, html?: boolean) =>
  renderToStaticMarkup(<RichText text={text} html={html} />);

describe("RichText html", () => {
  const readme = [
    '<h1 align="center">Relay</h1>',
    "",
    '<p align="center"><strong>One workspace</strong><br>for agents</p>',
    "",
    "<details><summary>More</summary>",
    "",
    "Hidden **markdown**.",
    "",
    "</details>",
  ].join("\n");

  it("drops HTML from answers", () => {
    expect(render(readme)).not.toContain("<h1");
  });

  it("renders a README's HTML around its Markdown", () => {
    const out = render(readme, true);
    expect(out).toContain('<h1 align="center">Relay</h1>');
    expect(out).toContain(
      '<p align="center"><strong>One workspace</strong><br/>',
    );
    expect(out).toMatch(
      /<details><summary>More<\/summary>[\s\S]*<strong>markdown<\/strong>[\s\S]*<\/details>/,
    );
  });

  it("strips what could restyle or script the app", () => {
    const out = render(
      [
        "<style>body{display:none}</style>",
        "<script>alert(1)</script>",
        '<img src="x.png" onerror="alert(1)">',
        '<iframe src="https://example.com"></iframe>',
        '<a href="javascript:alert(1)">link</a>',
        '<div style="position:fixed;inset:0">cover</div>',
      ].join("\n\n"),
      true,
    );
    expect(out).not.toMatch(
      /<style|<script|onerror|<iframe|javascript:|position:fixed/i,
    );
    expect(out).toContain("cover");
  });
});
