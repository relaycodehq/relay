// Inline atomic skill nodes follow T3 Code's ComposerSkillExtension (MIT).
import { Extension, Node, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import { Slice, type Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
  type HTMLAttributes,
} from "react";
import {
  quoteBlock,
  quoteLabel,
  quoteMarkdown,
  unquote,
} from "../lib/composer-quotes";
import {
  pasteBlock,
  pastedLines,
  pasteMarkdown,
  pastesAfter,
  type PastedText,
} from "../../shared/pasted-texts";
import type { DictationTarget } from "../lib/dictation/session";
import {
  beginDictation,
  ComposerDictation,
  endDictation,
  updateDictation,
} from "./composer-dictation";
export interface SkillPick {
  token: string;
  label: string;
  start: number;
  end: number;
}
export interface PromptInputHandle {
  insertSkill: (skill: SkillPick) => void;
  /** Replaces a range of the draft with plain text, or removes it, and puts the caret after it. */
  insertText: (range: { start: number; end: number; text: string }) => void;
  /** Puts files in as tags where the pointer is, or at the caret without one. */
  insertFiles: (paths: string[], point?: { left: number; top: number }) => void;
  /** Puts a quoted passage at the caret as a pill. */
  insertQuote: (text: string) => void;
  /** Puts a long paste at the caret as a pill; false when the message cannot hold it. */
  insertPaste: (text: string) => boolean;
  /** Drops the nth paste pill. */
  removePaste: (index: number) => void;
  /** Swaps the nth paste pill for its text. */
  inlinePaste: (index: number) => void;
  /** Where dictated words go: live at the caret, greyed while they may still change. */
  dictation: DictationTarget;
}
const Skill = Node.create({
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
const Paste = Node.create({
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
const fileMarkdown = (path: string) => "`" + path + "`";
const leaf = (node: PMNode) =>
  node.type.name === "relaySkill"
    ? node.attrs.token
    : node.type.name === "relayFile"
      ? fileMarkdown(node.attrs.path)
      : node.type.name === "relayQuote"
        ? quoteMarkdown(node.attrs.text)
        : node.type.name === "relayPaste"
          ? pasteMarkdown(node.attrs as PastedText)
          : node.type.name === "hardBreak"
            ? "\n"
            : "";
// A quote is a Markdown blockquote, so one that follows text on the same line
// starts a line of its own; promptContent drops that break again.
function serialize(content: Fragment, end = content.size) {
  let out = "",
    first = true;
  content.nodesBetween(0, end, (node, pos) => {
    if (node.isTextblock) {
      if (!first) out += "\n";
      first = false;
    } else if (node.isText) out += node.text!.slice(0, end - pos);
    else if (node.isLeaf) {
      if (node.type.name === "relayQuote" && out && !out.endsWith("\n"))
        out += "\n";
      out += leaf(node);
    }
  });
  return out;
}
export const promptText = (doc: PMNode, end = doc.content.size) =>
  serialize(doc.content, end);
const text = promptText;
function position(doc: PMNode, offset: number) {
  let result = 1,
    found = false;
  doc.descendants((node, pos) => {
    if (found || !node.isLeaf) return;
    const start = text(doc, pos).length,
      value = node.isText ? node.text! : leaf(node);
    if (offset >= start && offset <= start + value.length) {
      result =
        pos +
        (node.isText ? offset - start : offset === start ? 0 : node.nodeSize);
      found = true;
    } else if (offset > start) result = pos + node.nodeSize;
  });
  return result;
}
/**
 * Rebuilds the editor document from the draft text. Skill tokens, blockquotes
 * and file paths only become pills when this draft registered them, so text
 * the user typed by hand stays text. Fenced pastes always do; nobody types those.
 */
export function promptContent(
  value: string,
  labels: Record<string, string>,
  quotes: string[] = [],
  files: string[] = [],
): JSONContent {
  const nodes: JSONContent[] = [];
  const plain = (chunk: string) => {
    const pattern =
      /(\n|`(?:\/|[A-Za-z]:\\)[^`\n]*`|(?:\$|\/skill:)[A-Za-z_][A-Za-z0-9_.:-]*)/g;
    let last = 0;
    for (const m of chunk.matchAll(pattern)) {
      if (m.index! > last)
        nodes.push({ type: "text", text: chunk.slice(last, m.index) });
      if (m[0] === "\n") nodes.push({ type: "hardBreak" });
      else if (m[0].startsWith("`") && files.includes(m[0].slice(1, -1)))
        nodes.push({ type: "relayFile", attrs: { path: m[0].slice(1, -1) } });
      else if (
        labels[m[0]] &&
        (m.index === 0 || /\s/.test(chunk[m.index! - 1]))
      )
        nodes.push({
          type: "relaySkill",
          attrs: { token: m[0], label: labels[m[0]] },
        });
      else nodes.push({ type: "text", text: m[0] });
      last = m.index! + m[0].length;
    }
    if (last < chunk.length)
      nodes.push({ type: "text", text: chunk.slice(last) });
  };
  const quoted = (chunk: string) => {
    let last = 0;
    for (const m of chunk.matchAll(quoteBlock)) {
      const quote = unquote(m[0]);
      if (!quotes.includes(quote)) continue;
      // The break promptText puts before a quote that follows text.
      const joined = m.index! > 1 && chunk[m.index! - 2] !== "\n";
      plain(chunk.slice(last, m.index! - (joined ? 1 : 0)));
      nodes.push({ type: "relayQuote", attrs: { text: quote } });
      last = m.index! + m[0].length;
    }
    plain(chunk.slice(last));
  };
  let last = 0;
  for (const m of value.matchAll(pasteBlock)) {
    quoted(value.slice(last, m.index));
    nodes.push({
      type: "relayPaste",
      attrs: { n: Number(m[1]), text: m[3] },
    });
    last = m.index! + m[0].length;
  }
  quoted(value.slice(last));
  return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
}
/** The nth paste pill and where it sits. */
function pasteAt(doc: PMNode, index: number) {
  let found: { node: PMNode; pos: number } | undefined,
    seen = 0;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "relayPaste" && seen++ === index)
      found = { node, pos };
  });
  return found;
}
const content = promptContent;
/** The full passage shown while a quote pill is hovered. */
interface QuoteTip {
  text: string;
  left: number;
  top: number;
  bottom: number;
}
function stored<T>(key: string, fallback: T, valid: (v: unknown) => v is T) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function ComposerPromptInput({
  value,
  onChange,
  onCursor,
  onOpenPaste,
  placeholder,
  inputRef,
  handleRef,
  draftKey,
  "aria-label": ariaLabel,
  "aria-expanded": expanded,
  "aria-controls": controls,
  "aria-activedescendant": activeId,
  "aria-autocomplete": autocomplete,
  ...events
}: {
  value: string;
  onChange: (v: string) => void;
  onCursor: (pos: number) => void;
  /** Opens the nth paste pill's text. */
  onOpenPaste?: (index: number) => void;
  placeholder: string;
  inputRef: RefObject<HTMLElement | null>;
  handleRef: Ref<PromptInputHandle>;
  draftKey: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const callbacks = useRef({ onChange, onCursor, onOpenPaste });
  callbacks.current = { onChange, onCursor, onOpenPaste };
  const [tip, setTip] = useState<QuoteTip | null>(null);
  const labels = useRef<Record<string, string>>(
    stored(
      "skill-chips:" + draftKey,
      {},
      (v): v is Record<string, string> => !!v && typeof v === "object",
    ),
  );
  const quotes = useRef<string[]>(
    stored(
      "quote-chips:" + draftKey,
      [],
      (v): v is string[] =>
        Array.isArray(v) && v.every((q) => typeof q === "string"),
    ),
  );
  const files = useRef<string[]>(
    stored(
      "file-chips:" + draftKey,
      [],
      (v): v is string[] =>
        Array.isArray(v) && v.every((f) => typeof f === "string"),
    ),
  );
  const editor = useEditor({
    extensions: [
      Extension.create({
        name: "promptLimit",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction: (tr) => text(tr.doc).length <= 32000,
            }),
          ];
        },
      }),
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        link: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
      }),
      Skill,
      Quote,
      Paste,
      FileTag,
      ComposerDictation,
    ],
    content: content(value, labels.current, quotes.current, files.current),
    // The composer remounts per thread, so opening one lands in its input.
    autofocus: "end",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Message project",
        "aria-multiline": "true",
        class: "composer-prompt-input",
        "data-placeholder": placeholder,
      },
      handlePaste(view, event) {
        if (event.clipboardData?.files.length) return false;
        const plain = event.clipboardData?.getData("text/plain");
        if (plain === undefined) return false;
        // A pill copied within the draft, or from another, gets a new number.
        const fragment = view.state.schema.nodeFromJSON(
          content(
            pastesAfter(text(view.state.doc), plain),
            labels.current,
            quotes.current,
            files.current,
          ),
        ).firstChild!.content;
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(fragment, 0, 0))
            .scrollIntoView(),
        );
        return true;
      },
      clipboardTextSerializer: (slice) => serialize(slice.content),
      // The × inside a quote or paste pill removes it; the pill itself stays an atom.
      handleClickOn(view, _pos, node, nodePos, event) {
        if (
          node.type.name === "relayPaste" &&
          !(
            event.target instanceof Element &&
            event.target.closest(".composer-quote-remove")
          )
        ) {
          let index = 0;
          view.state.doc.descendants((other, pos) => {
            if (other.type.name === "relayPaste" && pos < nodePos) index++;
          });
          callbacks.current.onOpenPaste?.(index);
          return true;
        }
        if (
          !["relayQuote", "relayPaste"].includes(node.type.name) ||
          !(event.target instanceof Element) ||
          !event.target.closest(".composer-quote-remove")
        )
          return false;
        view.dispatch(
          closeHistory(
            view.state.tr.delete(nodePos, nodePos + node.nodeSize),
          ).scrollIntoView(),
        );
        return true;
      },
    },
    onUpdate({ editor }) {
      setTip(null);
      callbacks.current.onCursor(
        text(editor.state.doc, editor.state.selection.from).length,
      );
      callbacks.current.onChange(text(editor.state.doc));
    },
    onSelectionUpdate({ editor }) {
      callbacks.current.onCursor(
        text(editor.state.doc, editor.state.selection.from).length,
      );
    },
  });
  useEffect(() => {
    if (!editor) return;
    inputRef.current = editor.view.dom;
    return () => {
      inputRef.current = null;
    };
  }, [editor, inputRef]);
  // Hovering a pill shows the whole passage above it after a short pause.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let timer: number | undefined;
    const chipOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(".composer-quote-chip") : null;
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };
    const over = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (!chip) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = chip.getBoundingClientRect();
        setTip({
          text: chip.getAttribute("data-quote") ?? "",
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
        });
      }, 150);
    };
    const out = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (
        chip &&
        !(
          event.relatedTarget instanceof Element &&
          chip.contains(event.relatedTarget)
        )
      )
        hide();
    };
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseout", out);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      dom.removeEventListener("mouseover", over);
      dom.removeEventListener("mouseout", out);
      window.removeEventListener("scroll", hide, true);
    };
  }, [editor]);
  useEffect(() => {
    if (editor && text(editor.state.doc) !== value)
      editor.commands.setContent(
        content(value, labels.current, quotes.current, files.current),
        { emitUpdate: false },
      );
  }, [value, editor]);
  useEffect(() => {
    editor?.view.dom.setAttribute("data-placeholder", placeholder);
  }, [placeholder, editor]);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    dom.setAttribute("role", expanded ? "combobox" : "textbox");
    for (const [key, value] of Object.entries({
      "aria-expanded": expanded,
      "aria-controls": controls,
      "aria-activedescendant": activeId,
      "aria-autocomplete": autocomplete,
    })) {
      if (value === undefined) dom.removeAttribute(key);
      else dom.setAttribute(key, String(value));
    }
  }, [editor, expanded, controls, activeId, autocomplete]);
  useImperativeHandle(
    handleRef,
    () => ({
      insertSkill(pick) {
        if (!editor) return;
        labels.current[pick.token] = pick.label;
        localStorage.setItem(
          "skill-chips:" + draftKey,
          JSON.stringify(labels.current),
        );
        const from = position(editor.state.doc, pick.start),
          to = position(editor.state.doc, pick.end);
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, [
            {
              type: "relaySkill",
              attrs: { token: pick.token, label: pick.label },
            },
            { type: "text", text: " " },
          ])
          .run();
        editor.view.dispatch(closeHistory(editor.state.tr));
      },
      insertText({ start, end, text }) {
        if (!editor) return;
        const range = {
          from: position(editor.state.doc, start),
          to: position(editor.state.doc, end),
        };
        const chain = editor.chain().focus();
        // ProseMirror has no empty text nodes; removing is a delete.
        (text
          ? chain.insertContentAt(range, { type: "text", text })
          : chain.deleteRange(range)
        ).run();
      },
      insertFiles(paths, point) {
        if (!editor || !paths.length) return;
        files.current = [...new Set([...files.current, ...paths])];
        localStorage.setItem(
          "file-chips:" + draftKey,
          JSON.stringify(files.current),
        );
        const { doc } = editor.state;
        const hit = point && editor.view.posAtCoords(point)?.pos;
        // The pointer can land between blocks; the tags go in the nearest one.
        const at =
          hit === undefined
            ? editor.state.selection.from
            : TextSelection.near(doc.resolve(hit)).from;
        const $at = doc.resolve(at);
        // Tags keep a space on each side: two paths touching would read as one.
        const before = $at.nodeBefore,
          after = $at.nodeAfter;
        const space = { type: "text", text: " " };
        const nodes: JSONContent[] = paths.flatMap((path, i) => [
          ...(i ? [space] : []),
          { type: "relayFile", attrs: { path } },
        ]);
        if (before && !/\s$/.test(before.text ?? "")) nodes.unshift(space);
        if (!/^\s/.test(after?.text ?? "")) nodes.push(space);
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.chain().focus().insertContentAt(at, nodes).run();
        editor.view.dispatch(closeHistory(editor.state.tr));
      },
      insertQuote(quote) {
        if (!editor || !quote) return;
        const present: string[] = [];
        editor.state.doc.descendants((node) => {
          if (node.type.name === "relayQuote") present.push(node.attrs.text);
        });
        quotes.current = [...new Set([...present, quote])];
        localStorage.setItem(
          "quote-chips:" + draftKey,
          JSON.stringify(quotes.current),
        );
        // After any selection rather than over it: the quote came from the thread.
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.selection.to, {
            type: "relayQuote",
            attrs: { text: quote },
          })
          .run();
        editor.view.dispatch(closeHistory(editor.state.tr));
      },
      insertPaste(pasted) {
        if (!editor) return false;
        let n = 0;
        editor.state.doc.descendants((node) => {
          if (node.type.name === "relayPaste") n = Math.max(n, node.attrs.n);
        });
        const before = editor.state.doc;
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor
          .chain()
          .focus()
          .insertContent({
            type: "relayPaste",
            attrs: { n: n + 1, text: pasted },
          })
          .run();
        editor.view.dispatch(closeHistory(editor.state.tr));
        // The length limit rejects the transaction rather than truncating it.
        return editor.state.doc !== before;
      },
      removePaste(index) {
        const found = editor && pasteAt(editor.state.doc, index);
        if (!found) return;
        editor.view.dispatch(
          closeHistory(
            editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize),
          ),
        );
      },
      inlinePaste(index) {
        const found = editor && pasteAt(editor.state.doc, index);
        if (!found) return;
        const { schema } = editor.state;
        const nodes = String(found.node.attrs.text)
          .split("\n")
          .flatMap((line, i) => [
            ...(i ? [schema.nodes.hardBreak.create()] : []),
            ...(line ? [schema.text(line)] : []),
          ]);
        editor.view.dispatch(
          closeHistory(
            editor.state.tr.replaceWith(
              found.pos,
              found.pos + found.node.nodeSize,
              nodes,
            ),
          ),
        );
        editor.commands.focus();
      },
      dictation: {
        begin: () => editor?.isDestroyed === false && beginDictation(editor),
        update: (settled, tentative) =>
          editor?.isDestroyed === false &&
          updateDictation(editor, settled, tentative),
        end: (text) =>
          editor?.isDestroyed === false && endDictation(editor, text),
      },
    }),
    [editor, draftKey],
  );
  const tipAbove = !!tip && tip.top > 160;
  return (
    <div {...events}>
      <EditorContent editor={editor} />
      {tip &&
        createPortal(
          <div
            role="tooltip"
            className="composer-quote-tooltip"
            style={{
              left: Math.max(12, Math.min(tip.left, innerWidth - 12 - 440)),
              top: tipAbove ? tip.top : tip.bottom,
              transform: tipAbove
                ? "translateY(calc(-100% - 6px))"
                : "translateY(6px)",
            }}
          >
            "{tip.text}"
          </div>,
          document.body,
        )}
    </div>
  );
}
