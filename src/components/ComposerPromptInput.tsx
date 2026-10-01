// Inline atomic skill nodes follow T3 Code's ComposerSkillExtension (MIT).
import { Extension, Node, type Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createPortal } from "react-dom";
import { PreviewCard } from "@base-ui/react/preview-card";
import StarterKit from "@tiptap/starter-kit";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
  type HTMLAttributes,
} from "react";
import { quoteLabel, quoteMarkdown } from "../lib/composer-quotes";
import {
  pastedLines,
  pasteMarkdown,
  pastesAfter,
  type PastedText,
} from "../../shared/pasted-texts";
import {
  imageToken,
  isPastedImageName,
  shortImageName,
} from "../lib/image-refs";
import { formatSize } from "../lib/file-tree";
import { promptContent } from "../lib/prompt-content";
import {
  fileMarkdown,
  positionAt,
  promptText,
  serialize,
} from "../lib/prompt-text";
import { ImagePeek, PEEK_DELAY } from "./ImagePeek";
import type { DictationTarget } from "../lib/dictation/session";
import { draftChips } from "../lib/thread-storage";
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
  /** Puts screenshot pills in, like files. */
  insertImages: (ns: number[], point?: { left: number; top: number }) => void;
  /** Drops every pill for screenshot n. */
  removeImage: (n: number) => void;
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
/** What an image pill shows; the screenshot itself stays with the composer. */
export interface ImageChip {
  n: number;
  name: string;
  src: string;
  bytes: number;
}
interface ImageStorage {
  images: Map<number, ImageChip>;
  /** Live pills, redrawn when the screenshots behind them load or change. */
  views: Set<() => void>;
}
declare module "@tiptap/core" {
  interface Storage {
    relayImage: ImageStorage;
  }
}
// A screenshot's place in the message; sent as `[Image #n]`, the image itself rides along.
export const ImageTag = Node.create<object, ImageStorage>({
  name: "relayImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { n: { default: 1 } };
  },
  addStorage() {
    return { images: new Map(), views: new Set() };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-image]" }];
  },
  renderHTML({ node }) {
    return ["span", { "data-relay-image": "" }, imageToken(node.attrs.n)];
  },
  renderText({ node }) {
    return imageToken(node.attrs.n);
  },
  // A text selection across a pill outlines it; painting its insides blotches.
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      new Plugin({
        props: {
          decorations({ doc, selection }) {
            if (selection.empty) return null;
            const marked: Decoration[] = [];
            doc.nodesBetween(selection.from, selection.to, (node, pos) => {
              if (node.type.name === name)
                marked.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "in-selection",
                  }),
                );
            });
            return DecorationSet.create(doc, marked);
          },
        },
      }),
    ];
  },
  addNodeView() {
    const storage = this.storage;
    return ({ node }) => {
      const n: number = node.attrs.n;
      const dom = document.createElement("span");
      dom.className =
        "composer-skill-chip composer-file-chip composer-image-chip";
      dom.contentEditable = "false";
      dom.dataset.relayImage = "";
      dom.dataset.n = String(n);
      const draw = () => {
        const image = storage.images.get(n);
        // A paste's name says nothing, so its pill is just the picture.
        const pasted = !!image && isPastedImageName(image.name);
        dom.classList.toggle("missing", !image);
        dom.classList.toggle("pasted", pasted);
        dom.title = image
          ? `${image.name} · ${formatSize(image.bytes)}, sent as ${imageToken(n)}. Click to draw on it.`
          : "This screenshot is no longer in the draft";
        dom.replaceChildren();
        if (image) {
          const thumb = document.createElement("img");
          thumb.className = "composer-image-chip-thumb";
          thumb.src = image.src;
          thumb.alt = pasted ? `Image #${n}` : "";
          dom.append(thumb);
        } else {
          const thumb = document.createElement("span");
          thumb.className = "composer-image-chip-thumb";
          thumb.setAttribute("aria-hidden", "true");
          dom.append(thumb);
        }
        if (!pasted) {
          const label = document.createElement("span");
          label.textContent = image
            ? shortImageName(image.name)
            : `Image #${n}`;
          dom.append(label);
        }
      };
      draw();
      storage.views.add(draw);
      return {
        dom,
        update: (next) => next.type === node.type && next.attrs.n === n,
        destroy: () => storage.views.delete(draw),
      };
    };
  },
});
/** The nth paste pill and where it sits. */
export function pasteAt(doc: PMNode, index: number) {
  let found: { node: PMNode; pos: number } | undefined,
    seen = 0;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "relayPaste" && seen++ === index)
      found = { node, pos };
  });
  return found;
}
/** Puts tags in where the pointer is, or at the caret without one. */
function insertTags(
  editor: Editor,
  tags: JSONContent[],
  point?: { left: number; top: number },
) {
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
  const nodes: JSONContent[] = tags.flatMap((tag, i) => [
    ...(i ? [space] : []),
    tag,
  ]);
  if (before && !/\s$/.test(before.text ?? "")) nodes.unshift(space);
  if (!/^\s/.test(after?.text ?? "")) nodes.push(space);
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.chain().focus().insertContentAt(at, nodes).run();
  editor.view.dispatch(closeHistory(editor.state.tr));
}
/** The full passage shown while a quote pill is hovered. */
interface QuoteTip {
  text: string;
  left: number;
  top: number;
  bottom: number;
}
export function ComposerPromptInput({
  value,
  onChange,
  onCursor,
  onOpenPaste,
  onOpenImage,
  images,
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
  /** Opens screenshot n, from its pill. */
  onOpenImage?: (n: number) => void;
  images?: ImageChip[];
  placeholder: string;
  inputRef: RefObject<HTMLElement | null>;
  handleRef: Ref<PromptInputHandle>;
  draftKey: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const callbacks = useRef({ onChange, onCursor, onOpenPaste, onOpenImage });
  callbacks.current = { onChange, onCursor, onOpenPaste, onOpenImage };
  const [tip, setTip] = useState<QuoteTip | null>(null);
  const [peek, setPeek] = useState<{ anchor: Element; src: string } | null>(
    null,
  );
  const chips = draftChips(draftKey);
  const labels = useRef(chips.skills.load());
  const quotes = useRef(chips.quotes.load());
  const files = useRef(chips.files.load());
  const editor = useEditor({
    extensions: [
      Extension.create({
        name: "promptLimit",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction: (tr) => promptText(tr.doc).length <= 32000,
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
      ImageTag,
      ComposerDictation,
    ],
    content: promptContent(
      value,
      labels.current,
      quotes.current,
      files.current,
    ),
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
          promptContent(
            pastesAfter(promptText(view.state.doc), plain),
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
        if (node.type.name === "relayImage") {
          callbacks.current.onOpenImage?.(node.attrs.n);
          return true;
        }
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
        promptText(editor.state.doc, editor.state.selection.from).length,
      );
      callbacks.current.onChange(promptText(editor.state.doc));
    },
    onSelectionUpdate({ editor }) {
      callbacks.current.onCursor(
        promptText(editor.state.doc, editor.state.selection.from).length,
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
  // Hovering a screenshot pill grows its picture above it, as in the thread.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let timer: number | undefined;
    let hovered: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      hovered = null;
      setPeek(null);
    };
    const over = (event: MouseEvent) => {
      const chip =
        event.target instanceof Element
          ? event.target.closest(".composer-image-chip")
          : null;
      if (chip === hovered) return;
      hide();
      const thumb = chip?.querySelector<HTMLImageElement>("img");
      if (!chip || !thumb) return;
      hovered = chip;
      timer = window.setTimeout(
        () => setPeek({ anchor: chip, src: thumb.src }),
        PEEK_DELAY,
      );
    };
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseleave", hide);
    // Clicking opens the drawing editor, and typing may take the pill away.
    dom.addEventListener("mousedown", hide);
    dom.addEventListener("keydown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      dom.removeEventListener("mouseover", over);
      dom.removeEventListener("mouseleave", hide);
      dom.removeEventListener("mousedown", hide);
      dom.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [editor]);
  useEffect(() => {
    if (editor && promptText(editor.state.doc) !== value)
      editor.commands.setContent(
        promptContent(value, labels.current, quotes.current, files.current),
        { emitUpdate: false },
      );
  }, [value, editor]);
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.relayImage;
    storage.images = new Map(images?.map((image) => [image.n, image]));
    for (const draw of storage.views) draw();
  }, [images, editor]);
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
        chips.skills.save(labels.current);
        const from = positionAt(editor.state.doc, pick.start),
          to = positionAt(editor.state.doc, pick.end);
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
          from: positionAt(editor.state.doc, start),
          to: positionAt(editor.state.doc, end),
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
        chips.files.save(files.current);
        insertTags(
          editor,
          paths.map((path) => ({ type: "relayFile", attrs: { path } })),
          point,
        );
      },
      insertImages(ns, point) {
        if (!editor || !ns.length) return;
        insertTags(
          editor,
          ns.map((n) => ({ type: "relayImage", attrs: { n } })),
          point,
        );
      },
      removeImage(n) {
        if (!editor) return;
        const { doc, tr } = editor.state;
        doc.descendants((node, pos) => {
          if (node.type.name !== "relayImage" || node.attrs.n !== n) return;
          // The space put in beside the pill goes with it.
          const end = pos + node.nodeSize,
            $pos = doc.resolve(pos);
          const before = doc.textBetween($pos.start(), pos, "\n", "x");
          const spare =
            doc.textBetween(end, Math.min(end + 1, $pos.end())) === " " &&
            /(^|\s)$/.test(before);
          tr.delete(tr.mapping.map(pos), tr.mapping.map(end + (spare ? 1 : 0)));
        });
        if (tr.docChanged) editor.view.dispatch(closeHistory(tr));
      },
      insertQuote(quote) {
        if (!editor || !quote) return;
        const present: string[] = [];
        editor.state.doc.descendants((node) => {
          if (node.type.name === "relayQuote") present.push(node.attrs.text);
        });
        quotes.current = [...new Set([...present, quote])];
        chips.quotes.save(quotes.current);
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
      <PreviewCard.Root
        open={!!peek}
        onOpenChange={(open) => !open && setPeek(null)}
      >
        {peek && <ImagePeek src={peek.src} anchor={peek.anchor} />}
      </PreviewCard.Root>
    </div>
  );
}
