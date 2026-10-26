import { Node } from "@tiptap/core";
import type { Attrs } from "@tiptap/pm/model";
import type { PastedText } from "../../../../shared/pasted-texts";
import {
  filePill,
  pastePill,
  pillSpec,
  quotePill,
  skillPill,
  type PillLook,
} from "./Pill";
import { PILL_MARK } from "../../../lib/pill-marks";

/** What sets one kind of pill apart; `pill` supplies what they all share. */
interface PillKind {
  name: string;
  /** The attribute on its span, which pasted HTML is matched by. */
  mark: string;
  /** Its attributes, with the value each takes when none is given. */
  defaults: Attrs;
  /** What it shows, and stands for in the message that is sent. */
  look(attrs: Attrs): PillLook;
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
    parseHTML: () => [{ tag: `span[${kind.mark}]` }],
    renderHTML: ({ node }) =>
      pillSpec(kind.look(node.attrs), { contenteditable: "false" }),
    renderText: ({ node }) => kind.look(node.attrs).text,
  });

export const Skill = pill({
  name: "relaySkill",
  mark: PILL_MARK.skill,
  defaults: { token: "", label: "" },
  look: ({ token, label }) => skillPill(token, label),
});

// A quoted passage from the conversation; sent as a Markdown blockquote.
export const Quote = pill({
  name: "relayQuote",
  mark: PILL_MARK.quote,
  defaults: { text: "" },
  look: ({ text }) => quotePill(text),
});

// A long paste, kept where it was pasted; sent as its fenced text.
export const Paste = pill({
  name: "relayPaste",
  mark: PILL_MARK.paste,
  defaults: { n: 1, text: "" },
  look: (attrs) => pastePill(attrs as PastedText),
});

// A file on this computer, by path; sent as the path in backticks for the agent to read.
export const FileTag = pill({
  name: "relayFile",
  mark: PILL_MARK.file,
  defaults: { path: "" },
  look: ({ path }) => filePill(path),
});
