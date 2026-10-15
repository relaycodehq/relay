import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { quoteLabel, quoteMarkdown } from "../../../../shared/composer-quotes";
import {
  isPastedImageName,
  shortImageName,
} from "../../../../shared/image-refs";
import {
  pastedLines,
  pasteMarkdown,
  type PastedText,
} from "../../../../shared/pasted-texts";
import { fileMarkdown } from "../prompt-text";
import "./pills.css";

/**
 * What a pill shows. The editor draws its pills from ProseMirror and a sent
 * message from React; both take what they show from here and their markup
 * from the two renderers below, so a pill looks the same in both.
 */
export interface PillLook {
  kind: "skill" | "file" | "folder" | "quote" | "paste";
  label: string;
  /** Muted text after the label. */
  detail?: string;
  title?: string;
  /** What it stands for in the message's text. */
  text: string;
  /** Its mark in copied HTML, which a composer reads it back from on paste. */
  marks: Record<string, string>;
}

/** The attribute marking each kind of pill, with what it stands for as its value. */
export const PILL_MARK = {
  skill: "data-relay-skill",
  quote: "data-relay-quote",
  file: "data-relay-file",
  paste: "data-relay-paste",
} as const;

export const skillPill = (token: string, label: string): PillLook => ({
  kind: "skill",
  label,
  title: token,
  text: token,
  marks: { [PILL_MARK.skill]: token, "data-label": label },
});

export function filePill(path: string): PillLook {
  const folder = path.endsWith("/");
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return {
    kind: folder ? "folder" : "file",
    label: folder ? `${name}/` : name,
    title: path,
    text: fileMarkdown(path),
    marks: { [PILL_MARK.file]: path },
  };
}

export const quotePill = (text: string): PillLook => ({
  kind: "quote",
  label: quoteLabel(text, 40),
  text: quoteMarkdown(text),
  marks: { [PILL_MARK.quote]: text },
});

export function pastePill(paste: PastedText): PillLook {
  const lines = pastedLines(paste.text);
  return {
    kind: "paste",
    label: `Pasted text #${paste.n}`,
    detail: `${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`,
    title: "Show pasted text",
    text: pasteMarkdown(paste),
    marks: { [PILL_MARK.paste]: String(paste.n) },
  };
}

/** A screenshot pill: its picture, and a label unless it was pasted, whose name says nothing. */
export function imagePill(n: number, name: string | undefined) {
  const missing = name === undefined;
  const pasted = !missing && isPastedImageName(name);
  return {
    missing,
    pasted,
    label: missing ? `Image #${n}` : pasted ? undefined : shortImageName(name),
  };
}

export const pillClass = (
  kind: PillLook["kind"] | "image",
  ...flags: (string | false)[]
) => ["prompt-pill", kind, ...flags].filter(Boolean).join(" ");

const removeLabel = (look: PillLook) =>
  `Remove ${look.kind === "quote" ? "quote" : look.label}`;

/** The pill in the editor, whose icon turns into a × on hover. */
export function pillSpec(
  look: PillLook,
  attrs: Record<string, string>,
): DOMOutputSpec {
  return [
    "span",
    {
      ...attrs,
      ...look.marks,
      class: pillClass(look.kind),
      ...(look.title ? { title: look.title } : {}),
    },
    [
      "span",
      {
        class: "prompt-pill-icon prompt-pill-remove",
        role: "button",
        "aria-label": removeLabel(look),
      },
    ],
    ["span", { class: "prompt-pill-label" }, look.label],
    ...(look.detail
      ? [["span", { class: "prompt-pill-detail" }, look.detail] as const]
      : []),
  ];
}

/** The insides of a pill outside the editor. */
function PillParts({ look }: { look: PillLook }) {
  return (
    <>
      <span className="prompt-pill-icon" aria-hidden="true" />
      <span className="prompt-pill-label">{look.label}</span>
      {look.detail && <span className="prompt-pill-detail">{look.detail}</span>}
    </>
  );
}

type PillProps<T> = { look: PillLook } & Omit<T, "className" | "children">;

/** What a pill outside the editor carries: its marks, and its text for a copied selection. */
const sentAttributes = (look: PillLook) => ({
  ...look.marks,
  "data-copy": look.text,
  className: pillClass(look.kind),
  title: look.title,
});

/** A pill outside the editor, as a sent message shows it. */
export function Pill({
  look,
  ...props
}: PillProps<HTMLAttributes<HTMLSpanElement>>) {
  return (
    <span {...sentAttributes(look)} {...props}>
      <PillParts look={look} />
    </span>
  );
}

/** A pill that opens what it stands for. */
export function PillButton({
  look,
  ...props
}: PillProps<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button type="button" {...sentAttributes(look)} {...props}>
      <PillParts look={look} />
    </button>
  );
}
