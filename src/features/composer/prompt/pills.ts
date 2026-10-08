import { Node } from "@tiptap/core";
import type { Attrs, DOMOutputSpec } from "@tiptap/pm/model";
import { quoteLabel, quoteMarkdown } from "../composer-quotes";
import { fileMarkdown } from "../prompt-text";
import {
  pastedLines,
  pasteMarkdown,
  type PastedText,
} from "../../../../shared/pasted-texts";

/** What sets one kind of pill apart; `pill` supplies what they all share. */
interface PillKind {
  name: string;
  /** The `data-relay-*` attribute on its span, which pasted HTML is matched by. */
  marker: string;
  /** Its attributes, with the value each takes when none is given. */
  defaults: Attrs;
  /** The span's own attributes, besides the marker. */
  span(attrs: Attrs): Record<string, string>;
  /** What sits inside the span. */
  inside(attrs: Attrs): DOMOutputSpec[];
  /** What it turns into in the message that is sent. */
  text(attrs: Attrs): string;
}

/** An inline atom: one uneditable step for the caret, with its own markup. */
const pill = (kind: PillKind) =>
  Node.create({
    name: kind.name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () =>
      Object.fromEntries(
        Object.entries(kind.defaults).map(([key, value]) => [
          key,
          { default: value },
        ]),
      ),
    parseHTML: () => [{ tag: `span[${kind.marker}]` }],
    renderHTML: ({ node }) => [
      "span",
      {
        [kind.marker]: "",
        ...kind.span(node.attrs),
        contenteditable: "false",
      },
      ...kind.inside(node.attrs),
    ],
    renderText: ({ node }) => kind.text(node.attrs),
  });

const plain = (text: string): DOMOutputSpec => ["span", {}, text];
const icon = (className: string, ...glyph: string[]): DOMOutputSpec => [
  "span",
  { "aria-hidden": "true", class: className },
  ...glyph,
];
const removeButton = (label: string): DOMOutputSpec => [
  "span",
  { class: "composer-quote-remove", role: "button", "aria-label": label },
];

export const Skill = pill({
  name: "relaySkill",
  marker: "data-relay-skill",
  defaults: { token: "", label: "" },
  span: ({ token }) => ({ class: "composer-skill-chip", title: token }),
  inside: ({ label }) => [icon("composer-skill-icon", "◇"), plain(label)],
  text: ({ token }) => token,
});

// A quoted passage from the conversation; sent as a Markdown blockquote.
export const Quote = pill({
  name: "relayQuote",
  marker: "data-relay-quote",
  defaults: { text: "" },
  span: ({ text }) => ({ "data-quote": text, class: "composer-quote-chip" }),
  inside: ({ text }) => [
    removeButton("Remove quote"),
    ["span", { class: "composer-quote-text" }, `"${quoteLabel(text, 40)}"`],
  ],
  text: ({ text }) => quoteMarkdown(text),
});

// A long paste, kept where it was pasted; sent as its fenced text.
export const Paste = pill({
  name: "relayPaste",
  marker: "data-relay-paste",
  defaults: { n: 1, text: "" },
  span: () => ({ class: "paste-pill", title: "Show pasted text" }),
  inside: ({ n, text }) => {
    const lines = pastedLines(text);
    return [
      removeButton(`Remove Pasted text #${n}`),
      ["span", { class: "paste-pill-icon", "aria-hidden": "true" }],
      plain(`Pasted text #${n}`),
      [
        "span",
        { class: "paste-pill-lines" },
        `${lines} ${lines === 1 ? "line" : "lines"}`,
      ],
    ];
  },
  text: (attrs) => pasteMarkdown(attrs as PastedText),
});

// A file on this computer, by path; sent as the path in backticks for the agent to read.
export const FileTag = pill({
  name: "relayFile",
  marker: "data-relay-file",
  defaults: { path: "" },
  span: ({ path }) => ({
    class: "composer-skill-chip composer-file-chip",
    title: path,
  }),
  inside: ({ path }) => [
    icon(
      path.endsWith("/") ? "composer-file-icon folder" : "composer-file-icon",
    ),
    plain(
      (path.split(/[\\/]/).filter(Boolean).pop() ?? path) +
        (path.endsWith("/") ? "/" : ""),
    ),
  ],
  text: ({ path }) => fileMarkdown(path),
});
