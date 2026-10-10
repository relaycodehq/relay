import { expect, it } from "vitest";
import { selectionMarkdown, type MdNode } from "./selection-markdown";

/** An element as the converter reads it. */
const h = (
  tag: string,
  attrs: Record<string, string> = {},
  ...kids: (MdNode | string)[]
): MdNode => {
  const childNodes = kids.map((k) => (typeof k === "string" ? text(k) : k));
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    childNodes,
    get textContent() {
      return childNodes.map((c) => c.textContent).join("");
    },
    getAttribute: (key) => attrs[key] ?? null,
  };
};
const text = (value: string): MdNode => ({
  nodeType: 3,
  nodeName: "#text",
  textContent: value,
  childNodes: [],
});
const fragment = (...kids: MdNode[]): MdNode => ({
  ...h("x", {}, ...kids),
  nodeType: 11,
  nodeName: "#document-fragment",
});

it("keeps a paragraph's inline markdown and a file chip's path", () => {
  expect(
    selectionMarkdown(
      fragment(
        h(
          "p",
          {},
          "Open ",
          h("strong", {}, "threads"),
          " from ",
          h(
            "button",
            { class: "chat-file-link", title: "src/cache.ts:12" },
            h("svg", {}),
            h("span", {}, "cache.ts · L12"),
          ),
          " and ",
          h("code", {}, "npm test"),
          ".",
        ),
      ),
    ),
  ).toBe("Open **threads** from `src/cache.ts:12` and `npm test`.");
});

it("numbers items selected across a list from where they start", () => {
  const items = fragment(
    h("li", {}, "Outbox"),
    h("li", {}, "Images ", h("ul", {}, h("li", {}, "thumbs"))),
  );
  expect(selectionMarkdown(items, { list: { ordered: true, start: 3 } })).toBe(
    "3. Outbox\n4. Images\n   - thumbs",
  );
});

it("keeps whole lists, code without its buttons, and tables", () => {
  const selected = fragment(
    h("p", {}, "Ideas:"),
    h("ol", { start: "2" }, h("li", {}, "a"), h("li", {}, "b")),
    h(
      "div",
      { class: "markdown-code" },
      h("div", { class: "markdown-code-tools" }, h("button", {}, "Copy")),
      h("pre", {}, h("code", { class: "language-ts" }, "send();\n")),
    ),
    h(
      "div",
      { class: "markdown-table-frame" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "Fix", h("span", { "aria-hidden": "true" })),
            h("th", {}, "Cost"),
          ),
        ),
        h("tbody", {}, h("tr", {}, h("td", {}, "Cache"), h("td", {}, "a|b"))),
      ),
      h("button", { class: "markdown-table-copy" }),
    ),
  );
  expect(selectionMarkdown(selected)).toBe(
    [
      "Ideas:",
      "2. a\n3. b",
      "```ts\nsend();\n```",
      "| Fix | Cost |\n| --- | --- |\n| Cache | a\\|b |",
    ].join("\n\n"),
  );
});

it("fences code selected inside a block", () => {
  expect(
    selectionMarkdown(fragment(text("const a = 1;\nconst b = 2;")), {
      code: { lang: "ts" },
    }),
  ).toBe("```ts\nconst a = 1;\nconst b = 2;\n```");
});
