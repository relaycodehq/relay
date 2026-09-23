// Inline atomic skill nodes follow T3 Code's ComposerSkillExtension (MIT).
import { Extension, Node, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";
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
export interface SkillPick {
  token: string;
  label: string;
  start: number;
  end: number;
}
export interface PromptInputHandle {
  insertSkill: (skill: SkillPick) => void;
  /** Replaces a range of the draft with plain text and puts the caret after it. */
  insertText: (range: { start: number; end: number; text: string }) => void;
  /** Adds a quoted passage as a pill ahead of anything already typed. */
  insertQuote: (text: string) => void;
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
const leaf = (node: PMNode) =>
  node.type.name === "relaySkill"
    ? node.attrs.token
    : node.type.name === "relayQuote"
      ? quoteMarkdown(node.attrs.text)
      : node.type.name === "hardBreak"
        ? "\n"
        : "";
export const promptText = (doc: PMNode, end = doc.content.size) =>
  doc.textBetween(0, end, "\n", leaf);
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
 * Rebuilds the editor document from the draft text. Skill tokens and
 * blockquotes only become pills when this draft registered them, so text the
 * user typed by hand stays text.
 */
export function promptContent(
  value: string,
  labels: Record<string, string>,
  quotes: string[] = [],
): JSONContent {
  const nodes: JSONContent[] = [];
  const plain = (chunk: string) => {
    const pattern = /(\n|(?:\$|\/skill:)[A-Za-z_][A-Za-z0-9_.:-]*)/g;
    let last = 0;
    for (const m of chunk.matchAll(pattern)) {
      if (m.index! > last)
        nodes.push({ type: "text", text: chunk.slice(last, m.index) });
      if (m[0] === "\n") nodes.push({ type: "hardBreak" });
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
  let last = 0;
  for (const m of value.matchAll(quoteBlock)) {
    const quote = unquote(m[0]);
    if (!quotes.includes(quote)) continue;
    plain(value.slice(last, m.index));
    nodes.push({ type: "relayQuote", attrs: { text: quote } });
    last = m.index! + m[0].length;
  }
  plain(value.slice(last));
  return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
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
  placeholder: string;
  inputRef: RefObject<HTMLElement | null>;
  handleRef: Ref<PromptInputHandle>;
  draftKey: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const callbacks = useRef({ onChange, onCursor });
  callbacks.current = { onChange, onCursor };
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
    ],
    content: content(value, labels.current, quotes.current),
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
        const fragment = view.state.schema.nodeFromJSON(
          content(plain, labels.current, quotes.current),
        ).firstChild!.content;
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(fragment, 0, 0))
            .scrollIntoView(),
        );
        return true;
      },
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, "\n", leaf),
      // The × inside a quote pill removes it; the pill itself stays an atom.
      handleClickOn(view, _pos, node, nodePos, event) {
        if (
          node.type.name !== "relayQuote" ||
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
        content(value, labels.current, quotes.current),
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
        editor
          .chain()
          .focus()
          .insertContentAt(
            {
              from: position(editor.state.doc, start),
              to: position(editor.state.doc, end),
            },
            { type: "text", text },
          )
          .run();
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
        // Quotes stack at the start of the message, ahead of anything typed.
        let pos = 1;
        const first = editor.state.doc.firstChild;
        if (first)
          for (let i = 0; i < first.childCount; i++) {
            const child = first.child(i);
            if (child.type.name !== "relayQuote") break;
            pos += child.nodeSize;
          }
        const empty = !text(editor.state.doc);
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor
          .chain()
          .focus()
          .insertContentAt(pos, { type: "relayQuote", attrs: { text: quote } })
          .run();
        if (!empty) editor.commands.focus("end");
        editor.view.dispatch(closeHistory(editor.state.tr));
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
