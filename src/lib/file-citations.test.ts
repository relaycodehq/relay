import { describe, expect, it } from "vitest";
import { normalizeFileCitations } from "./file-citations";

const citation =
  ':codex-file-citation{path="/Users/me/Downloads/source.pdf" purpose="source"}';

describe("file citations", () => {
  it("turns the PDF directive into a file link, preserving the surrounding prose", () => {
    expect(normalizeFileCitations(`I checked your PDF: ${citation}.`)).toBe(
      "I checked your PDF: [source.pdf](/Users/me/Downloads/source.pdf).",
    );
  });

  it("accepts reordered attributes, spaces in paths, and line ranges", () => {
    expect(
      normalizeFileCitations(
        ':codex-file-citation{purpose="source" path="src/my file.ts" line_range_start=12 line_range_end=20}',
      ),
    ).toBe("[my file.ts:12-20](src/my%20file.ts:12-20)");
  });

  it("escapes filenames that contain Markdown, URL syntax, or braces", () => {
    expect(
      normalizeFileCitations(
        ':codex-file-citation{path="/tmp/a_[b](c)#50%{draft}.pdf"}',
      ),
    ).toBe(
      "[a\\_\\[b\\](c)#50%{draft}.pdf](/tmp/a_%5Bb%5D%28c%29%2350%25%7Bdraft%7D.pdf)",
    );
  });

  it.each([
    `\`${citation}\``,
    `\`\`example\n${citation}\n\`\``,
    `\`\`\`text\n${citation}\n\`\`\``,
    `~~~~\n${citation}\n~~~~`,
    `    ${citation}`,
    `> \`\`\`text\n> ${citation}\n> \`\`\``,
    `[${citation}](https://example.com)`,
    `<!-- ${citation} -->`,
    `\\${citation}`,
  ])("leaves code, links, HTML and escaped examples alone: %s", (text) => {
    expect(normalizeFileCitations(text)).toBe(text);
  });

  it.each([
    ':codex-file-citation{path="/tmp/source.pdf"',
    ':codex-file-citation{purpose="source"}',
    ':codex-file-citation{path=""}',
    ':codex-file-citation{path="javascript:alert(1)"}',
    ':codex-file-citation{path="https://example.com/a.pdf"}',
    ':codex-file-citation{path="/tmp/a.pdf" path="/tmp/b.pdf"}',
    ':codex-file-citation{path="/tmp/a.pdf" invalid}',
    ':codex-file-citation{path="/tmp/\uD800.pdf"}',
  ])("preserves incomplete, malformed and non-file directives: %s", (text) => {
    expect(normalizeFileCitations(text)).toBe(text);
  });

  it("handles several citations around code without rewriting the code", () => {
    const out = normalizeFileCitations(
      `${citation} \`${citation}\` ${citation}`,
    );
    expect(out.match(/\[source.pdf\]/g)).toHaveLength(2);
    expect(out).toContain(`\`${citation}\``);
    expect(normalizeFileCitations(out)).toBe(out);
  });
});
