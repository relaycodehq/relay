import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "./RichText";

const render = (text: string, html?: boolean) =>
  renderToStaticMarkup(<RichText text={text} html={html} />);

describe("RichText file citations", () => {
  const text =
    'I checked your PDF: :codex-file-citation{path="/Users/me/Downloads/source.pdf" purpose="source"}';

  it("renders an outside citation as the existing clickable file chip", () => {
    const out = renderToStaticMarkup(
      <RichText text={text} projectRoot="/project" onOpenFile={() => {}} />,
    );
    expect(out).toContain('class="chat-file-link"');
    expect(out).toContain('title="/Users/me/Downloads/source.pdf"');
    expect(out).toContain("source.pdf</span>");
    expect(out).not.toContain("codex-file-citation");
  });

  it("shows a project folder's full path on hover", () => {
    const out = renderToStaticMarkup(
      <RichText
        text="Saved in `HousePlanner/`."
        projectRoot="/Users/me/Projects/"
        onOpenFile={() => {}}
      />,
    );
    expect(out).toContain('title="/Users/me/Projects/HousePlanner"');
    expect(out).toContain("HousePlanner</span>");
  });

  it("shows a readable filename without a file opener", () => {
    expect(render(text)).toBe(
      '<div class="markdown"><p>I checked your PDF: <span>source.pdf</span></p></div>',
    );
  });

  it("keeps citations literal in user messages and file previews", () => {
    expect(renderToStaticMarkup(<RichText text={text} typed />)).toContain(
      "codex-file-citation",
    );
    expect(render(text, true)).toContain("codex-file-citation");
  });
});

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

describe("RichText math", () => {
  it("sets formulas apart from prose, in every notation agents use", () => {
    const out = render(
      [
        "Inline \\(a+b\\), $x_1$ and $$y$$.",
        "",
        "\\[",
        "E = mc^2",
        "\\]",
        "",
        "$$ \\int_0^1 f $$",
      ].join("\n"),
    );
    expect(out.match(/<code>(?:a\+b|x_1|y)<\/code>/g)).toHaveLength(3);
    expect(out).toContain('<pre class="math-block-source">E = mc^2</pre>');
    expect(out).toContain('<pre class="math-block-source">\\int_0^1 f</pre>');
  });

  it("does not take prices or shell variables for formulas", () => {
    const out = render("It costs $5 and $10; set $HOME/$USER.");
    expect(out).toContain("It costs $5 and $10; set $HOME/$USER.");
    expect(out).not.toContain("<code");
  });

  it("leaves code alone", () => {
    const out = render("`$x$`\n\n```\n\\[ a \\]\n$$\n```");
    expect(out).not.toContain("math-");
  });

  it("shows an unfinished formula as source", () => {
    expect(render("$$\n\\frac{a}{")).toContain("math-block-source");
  });

  it("keeps math working in a file's sanitized HTML", () => {
    const out = render(
      '<p align="center">hi</p>\n\n$$\nx^2\n$$\n\nand $y$',
      true,
    );
    expect(out).toContain('<pre class="math-block-source">x^2</pre>');
    expect(out).toContain("<code>y</code>");
  });
});

describe("RichText typed", () => {
  const typed = (text: string) =>
    renderToStaticMarkup(<RichText text={text} typed />);

  it("shows a person's lines, indentation and symbols as typed", () => {
    const out = typed(
      [
        "Fix the test",
        "# not a heading",
        "- not a list",
        "    at Object.<anonymous> (src/cache.ts:12:3)",
        "call f(*args, **kwargs) in ~/src and ~/dist, pay $x$ <b>",
      ].join("\n"),
    );
    expect(out).not.toMatch(/<h1|<ul|<li|<em|<strong|<del|<b>|katex/);
    expect(out).toContain("Fix the test\n# not a heading\n- not a list\n");
    expect(out).toContain(" ".repeat(4) + "at Object.");
    expect(out).toContain("~/src and ~/dist, pay $x$ &lt;b&gt;");
  });

  it("keeps fences, quotes, code spans and links", () => {
    const out = typed(
      [
        "> quoted from the answer",
        "",
        "see `cache.ts` at https://example.com",
        "```ts",
        "  const x = 1;",
        "```",
      ].join("\n"),
    );
    expect(out).toContain("<blockquote");
    expect(out).toContain("<code>cache.ts</code>");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("  const x = 1;");
  });
});

describe("RichText lists", () => {
  it("renders tight, loose and nested lists without key warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render("- one\n- two\n  - nested\n\n1. first\n\n2. second\n");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
