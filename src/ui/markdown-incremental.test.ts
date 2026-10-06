import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import type { Pluggable, Plugin } from "unified";
import { describe, expect, it } from "vitest";
import { streamingMarkdownTail } from "./markdown-incremental";

const F = "```ts\nconst x = 1;\n```\n\n";

/** Renders like RichText, recording what the parser is handed and the tree before later transforms. */
function render(
  source: string,
  plugin?: Plugin<[], Root>,
  after: Pluggable[] = [],
) {
  const parses: string[] = [];
  let tree: Root | undefined;
  const observe: Plugin<[], Root> = function () {
    const parse = this.parser!;
    this.parser = (text, file) => {
      parses.push(text);
      return parse(text, file);
    };
  };
  const capture: Plugin<[], Root> = () => (root) => {
    tree = structuredClone(root);
  };
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [
          remarkGfm,
          observe,
          capture,
          ...(plugin ? [plugin] : []),
          ...after,
        ],
      },
      source,
    ),
  );
  return { html, tree, parses };
}

const plain = (source: string, after: Pluggable[] = []) => {
  const { html, tree } = render(source, undefined, after);
  return { html, tree };
};

function streamMatchesFullParse(source: string) {
  const plugin = streamingMarkdownTail();
  let reused = 0;
  for (let n = 0; n <= source.length; n++) {
    const text = source.slice(0, n);
    const { html, tree, parses } = render(text, plugin);
    expect({ html, tree }, JSON.stringify(text)).toEqual(plain(text));
    if (parses[0] !== text) reused++;
  }
  return reused;
}

describe("streamed answers parse like a full parse at every length", () => {
  const lead = "# Answer\n\n" + F;
  it.each([
    ["a late definition", lead + "**bold** and [later]\n\n[later]: /target"],
    [
      "a loose list continuation, then an unclosed fence",
      lead + "- first\n\n  next\n\n```ts\nunclosed",
    ],
    ["CRLF", lead + "paragraph\r\nnext"],
    ["a BOM where the suffix starts", lead + "﻿tail"],
    ["a late footnote definition", lead + "text[^1]\n\n[^1]: note"],
    [
      "a tilde fence around a shorter one",
      lead + "~~~~md\n~~~\nin\n~~~\n~~~~\n\nafter",
    ],
    [
      "two closed fences between paragraphs",
      lead + "one\n\n```js\na()\n```\n\ntwo\n\n~~~\nb\n~~~\n\nthree",
    ],
    [
      "a fence inside a blockquote",
      lead + "> ```\n> q\n> ```\n\n> more\n\nend",
    ],
    ["a table after a fence", lead + "| a | b |\n| - | - |\n| 1 | 2 |\n\ndone"],
    [
      "indented code right after a fence",
      lead + "    indented\n    code\n\nend",
    ],
  ])("%s", (_name, source) => {
    streamMatchesFullParse(source);
  });

  it("actually takes the cached path while streaming", () => {
    const reused = streamMatchesFullParse(
      "intro\n\n```py\nprint(1)\n```\n\n- a\n- b\n\n```\nz\n```\n\n\n\ntail text",
    );
    expect(reused).toBeGreaterThan(20);
  });
});

describe("what the parser is handed", () => {
  // Each step: the text rendered and what the underlying parser should see.
  const sequences: [string, [string, string[] | "whole"][]][] = [
    [
      "reuses the prefix and moves the boundary forward",
      [
        [F + "Hello", "whole"],
        [F + "Hello again", ["Hello again"]],
        [
          F + "Hello again\n\n```\ny\n```\n\nz",
          ["Hello again\n\n```\ny\n```\n\nz"],
        ],
        [F + "Hello again\n\n```\ny\n```\n\nzz", ["zz"]],
      ],
    ],
    [
      "an empty suffix",
      [
        ["```\nx\n```\n\nq", "whole"],
        ["```\nx\n```\n\n", [""]],
      ],
    ],
    [
      "no blank line after the fence",
      [
        ["```\nx\n```\ntext", "whole"],
        ["```\nx\n```\ntext2", "whole"],
      ],
    ],
    [
      "the blank line arrives later",
      [
        ["```\nx\n```\n", "whole"],
        ["```\nx\n```\n\n", "whole"],
        ["```\nx\n```\n\nz", ["z"]],
      ],
    ],
    [
      "a shorter tilde line inside a longer tilde fence",
      [
        ["~~~~\n~~~\n~~~~\n\nq", "whole"],
        ["~~~~\n~~~\n~~~~\n\nqr", ["qr"]],
      ],
    ],
    [
      "three spaces of fence indent",
      [
        ["   ```\n   x\n   ```\n\nq", "whole"],
        ["   ```\n   x\n   ```\n\nqq", ["qq"]],
      ],
    ],
    [
      "spaces and tabs on the blank line",
      [
        ["```\nx\n```\n  \t\nq", "whole"],
        ["```\nx\n```\n  \t\nqq", ["qq"]],
      ],
    ],
    [
      "indented code after the fence",
      [
        [F + "    code", "whole"],
        [F + "    code2", ["    code2"]],
      ],
    ],
    [
      "an unclosed fence",
      [
        ["```ts\nx\n\n", "whole"],
        ["```ts\nx\n\ny", "whole"],
      ],
    ],
    [
      "a fence inside a list item",
      [
        ["- a\n\n  ```\n  x\n  ```\n\n  q", "whole"],
        ["- a\n\n  ```\n  x\n  ```\n\n  qq", "whole"],
      ],
    ],
    [
      "a fence inside a blockquote",
      [
        ["> ```\n> x\n> ```\n\nq", "whole"],
        ["> ```\n> x\n> ```\n\nqq", "whole"],
      ],
    ],
    [
      "a definition before the fence",
      [
        ["[a]: /x\n\n" + F + "s", "whole"],
        ["[a]: /x\n\n" + F + "st", "whole"],
      ],
    ],
    [
      "a closing run shorter than the opener",
      [
        ["````\nx\n```\n\nq", "whole"],
        ["````\nx\n```\n\nqq", "whole"],
      ],
    ],
    [
      "text after the closing run",
      [
        ["```\nx\n``` no\n\nq", "whole"],
        ["```\nx\n``` no\n\nqq", "whole"],
      ],
    ],
    [
      "a tilde line does not close a backtick fence",
      [
        ["```\nx\n~~~\n\nq", "whole"],
        ["```\nx\n~~~\n\nqq", "whole"],
      ],
    ],
    [
      "edits and replacements fail the prefix test",
      [
        [F + "a", "whole"],
        [F.replace("x", "y") + "a", "whole"],
        ["zz", "whole"],
        [F + "a", "whole"],
      ],
    ],
  ];

  it.each(sequences)("%s", (_name, steps) => {
    const plugin = streamingMarkdownTail();
    for (const [text, expected] of steps) {
      const { html, tree, parses } = render(text, plugin);
      expect(parses, JSON.stringify(text)).toEqual(
        expected === "whole" ? [text] : expected,
      );
      expect({ html, tree }).toEqual(plain(text));
    }
  });
});

it("never lets an edited prefix or a replaced message leak into later renders", () => {
  const plugin = streamingMarkdownTail();
  for (const text of [
    F.replace("1", "2") + "Edit",
    "Replacement",
    F + "Hello again",
  ]) {
    const { html, tree } = render(text, plugin);
    expect({ html, tree }).toEqual(plain(text));
  }
});

it("keeps the cache pristine when later plugins mutate the tree", () => {
  const mutate: Plugin<[], Root> = () => (root) => {
    for (const node of root.children) {
      (node.data ??= {}).hProperties = { id: "x" };
      if (node.type === "code") node.value += " // mutated";
    }
    root.children.splice(0, 1);
  };
  const plugin = streamingMarkdownTail();
  const steps = ["# T\n\n" + F + "one", "# T\n\n" + F + "one two"];
  for (const text of steps) {
    const { html, parses } = render(text, plugin, [mutate]);
    expect(html).toBe(plain(text, [mutate]).html);
    expect(html.match(/mutated/g)).toHaveLength(1);
    if (text === steps[1]) expect(parses).toEqual(["one two"]);
  }
  const clean = "# T\n\n" + F + "one two three";
  const { html, tree, parses } = render(clean, plugin);
  expect(parses).toEqual(["one two three"]);
  expect(html).toContain("const x = 1;\n</code>");
  expect({ html, tree }).toEqual(plain(clean));
});

it("gives nodes after the prefix their absolute positions", () => {
  const source = F + "para\n\n```\ny\n```\n\nlast";
  const plugin = streamingMarkdownTail();
  render(F + "p", plugin);
  const { tree, parses } = render(source, plugin);
  expect(parses).toEqual(["para\n\n```\ny\n```\n\nlast"]);
  expect(tree!.position!.start).toEqual({ line: 1, column: 1, offset: 0 });
  expect(tree).toEqual(plain(source).tree);
  const last = tree!.children.at(-1)!;
  expect(last.position!.start.line).toBe(11);
  expect(
    source.slice(last.position!.start.offset, last.position!.end.offset),
  ).toBe("last");
});

it("falls back to a full parse for a late definition without dropping the cache", () => {
  const plugin = streamingMarkdownTail();
  render(F + "[a]", plugin);

  const linked = render(F + "[a]\n\n[a]: /x", plugin);
  expect(linked.parses).toEqual(["[a]\n\n[a]: /x", F + "[a]\n\n[a]: /x"]);
  expect(linked.html).toContain('<a href="/x">a</a>');

  const unlinked = render(F + "[a] more", plugin);
  expect(unlinked.parses).toEqual(["[a] more"]);
  expect(unlinked.html).toContain("<p>[a] more</p>");
});

it("hands text with a carriage return or BOM to the parser whole, keeping the cache", () => {
  const plugin = streamingMarkdownTail();
  render(F + "a", plugin);
  for (const text of [F + "a\r\nb", F + "a﻿b"]) {
    const { html, tree, parses } = render(text, plugin);
    expect(parses).toEqual([text]);
    expect({ html, tree }).toEqual(plain(text));
  }
  expect(render(F + "ab", plugin).parses).toEqual(["ab"]);
});

it("treats only a processor's first parse as the document", () => {
  const synthetic = "```\nq\n```\n\nz";
  const reparse: Plugin<[], Root> = function () {
    const processor = this;
    return () => {
      processor.parse(synthetic);
    };
  };
  const plugin = streamingMarkdownTail();
  expect(render(F + "Hello", plugin, [reparse]).parses).toEqual([
    F + "Hello",
    synthetic,
  ]);
  expect(render(F + "Hello again", plugin).parses).toEqual(["Hello again"]);
});

it("keeps one cache per plugin instance", () => {
  const first = streamingMarkdownTail();
  const second = streamingMarkdownTail();
  render(F + "a", first);
  expect(render(F + "ab", second).parses).toEqual([F + "ab"]);
  expect(render(F + "abc", first).parses).toEqual(["abc"]);
});

it("leaves a processor without a parser alone", () => {
  const plugin = streamingMarkdownTail() as unknown as (
    this: object,
  ) => unknown;
  const bare = {};
  expect(() => plugin.call(bare)).not.toThrow();
  expect(bare).toEqual({});
});
