// Inline atomic skill nodes follow T3 Code's ComposerSkillExtension (MIT).
import { Node } from "@tiptap/core";
import { quoteLabel, quoteMarkdown } from "../composer-quotes";
import { fileMarkdown } from "../prompt-text";
import {
  pastedLines,
  pasteMarkdown,
  type PastedText,
} from "../../../../shared/pasted-texts";

export const Skill = Node.create({
  name: "relaySkill",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { token: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-skill]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-relay-skill": "",
        class: "composer-skill-chip",
        title: node.attrs.token,
        contenteditable: "false",
      },
      ["span", { "aria-hidden": "true", class: "composer-skill-icon" }, "◇"],
      ["span", {}, node.attrs.label],
    ];
  },
  renderText({ node }) {
    return node.attrs.token;
  },
});
// A quoted passage from the conversation; sent as a Markdown blockquote.
export const Quote = Node.create({
  name: "relayQuote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { text: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-quote]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-relay-quote": "",
        "data-quote": node.attrs.text,
        class: "composer-quote-chip",
        contenteditable: "false",
      },
      [
        "span",
        {
          class: "composer-quote-remove",
          role: "button",
          "aria-label": "Remove quote",
        },
      ],
      [
        "span",
        { class: "composer-quote-text" },
        `"${quoteLabel(node.attrs.text, 40)}"`,
      ],
    ];
  },
  renderText({ node }) {
    return quoteMarkdown(node.attrs.text);
  },
});
// A long paste, kept where it was pasted; sent as its fenced text.
export const Paste = Node.create({
  name: "relayPaste",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { n: { default: 1 }, text: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-paste]" }];
  },
  renderHTML({ node }) {
    const lines = pastedLines(node.attrs.text);
    return [
      "span",
      {
        "data-relay-paste": "",
        class: "paste-pill",
        title: "Show pasted text",
        contenteditable: "false",
      },
      [
        "span",
        {
          class: "composer-quote-remove",
          role: "button",
          "aria-label": `Remove Pasted text #${node.attrs.n}`,
        },
      ],
      ["span", { class: "paste-pill-icon", "aria-hidden": "true" }],
      ["span", {}, `Pasted text #${node.attrs.n}`],
      [
        "span",
        { class: "paste-pill-lines" },
        `${lines} ${lines === 1 ? "line" : "lines"}`,
      ],
    ];
  },
  renderText({ node }) {
    return pasteMarkdown(node.attrs as PastedText);
  },
});
// A file on this computer, by path; sent as the path in backticks for the agent to read.
export const FileTag = Node.create({
  name: "relayFile",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { path: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-file]" }];
  },
  renderHTML({ node }) {
    const path: string = node.attrs.path;
    return [
      "span",
      {
        "data-relay-file": "",
        class: "composer-skill-chip composer-file-chip",
        title: path,
        contenteditable: "false",
      },
      ["span", { "aria-hidden": "true", class: "composer-file-icon" }],
      ["span", {}, path.split(/[\\/]/).filter(Boolean).pop() ?? path],
    ];
  },
  renderText({ node }) {
    return fileMarkdown(node.attrs.path);
  },
});
