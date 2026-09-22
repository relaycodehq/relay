// Inline atomic skill nodes follow T3 Code's ComposerSkillExtension (MIT).
import { Extension, Node, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
  type HTMLAttributes,
} from "react";
export interface SkillPick {
  token: string;
  label: string;
  start: number;
  end: number;
}
export interface PromptInputHandle {
  insertSkill: (skill: SkillPick) => void;
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
const leaf = (node: PMNode) =>
  node.type.name === "relaySkill"
    ? node.attrs.token
    : node.type.name === "hardBreak"
      ? "\n"
      : "";
const text = (doc: PMNode, end = doc.content.size) =>
  doc.textBetween(0, end, "\n", leaf);
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
function content(value: string, labels: Record<string, string>): JSONContent {
  const nodes: JSONContent[] = [];
  const pattern = /(\n|(?:\$|\/skill:)[A-Za-z_][A-Za-z0-9_.:-]*)/g;
  let last = 0;
  for (const m of value.matchAll(pattern)) {
    if (m.index! > last)
      nodes.push({ type: "text", text: value.slice(last, m.index) });
    if (m[0] === "\n") nodes.push({ type: "hardBreak" });
    else if (labels[m[0]] && (m.index === 0 || /\s/.test(value[m.index! - 1])))
      nodes.push({
        type: "relaySkill",
        attrs: { token: m[0], label: labels[m[0]] },
      });
    else nodes.push({ type: "text", text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < value.length)
    nodes.push({ type: "text", text: value.slice(last) });
  return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
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
  const labels = useRef<Record<string, string>>(
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("skill-chips:" + draftKey) ?? "{}",
        );
      } catch {
        return {};
      }
    })(),
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
    ],
    content: content(value, labels.current),
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
          content(plain, labels.current),
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
    },
    onUpdate({ editor }) {
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
  useEffect(() => {
    if (editor && text(editor.state.doc) !== value)
      editor.commands.setContent(content(value, labels.current), {
        emitUpdate: false,
      });
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
    }),
    [editor, draftKey],
  );
  return (
    <div {...events}>
      <EditorContent editor={editor} />
    </div>
  );
}
