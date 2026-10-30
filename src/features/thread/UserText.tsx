import { useCallback, useMemo, useState } from "react";
import { pasteBlock, type PastedText } from "../../../shared/pasted-texts";
import { quoteBlock, unquote } from "../../../shared/composer-quotes";
import {
  chatFileLink,
  type ProjectFileLink,
} from "../../../shared/project-file-links";
import { isOutsideFilePath } from "../../../shared/markdown-links";
import { PastedTextPill } from "../composer/PastedTextCard";
import { Pill, skillPill } from "../composer/prompt/Pill";
import { QuoteTooltip, useQuoteTip } from "../composer/prompt/QuoteTip";
import {
  copyWithPills,
  type CopiedPills,
} from "../composer/prompt/pill-clipboard";
import { RichText } from "../../ui/RichText";
import { skillMentions, type SentSkill } from "../../../shared/skill-mentions";
import { FilePill, ImagePill, QuotePill, type SentImage } from "./SentPills";
import "./user-text.css";

// A token becomes inline code the pill replaces; one already in a code span is
// pilled as it stands (as the composer does), one in a fence stays text.
const codeOrToken = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)|\[Image #\d+\]/g;
// Marks a skill's code span apart from a `$name` the user wrote as code.
const skillMark = "\uE000";

const tokenAsCode = (text: string, skills: ReadonlySet<string>) => {
  let out = "",
    last = 0;
  const prose = (chunk: string) => {
    let at = 0;
    for (const m of skillMentions(chunk, skills)) {
      out += chunk.slice(at, m.start) + `\`${skillMark}${m.name}\``;
      at = m.end;
    }
    out += chunk.slice(at);
  };
  for (const m of text.matchAll(codeOrToken)) {
    prose(text.slice(last, m.index));
    out += m[1] ?? `\`${m[0]}\``;
    last = m.index! + m[0].length;
  }
  prose(text.slice(last));
  return out;
};

const sentToken = /^\[Image #(\d+)\]$/;

type PilledCode =
  { skill: string } | { image: number } | { file: ProjectFileLink };

/** What a code span in a sent message shows as a pill, if anything. */
function pilledCode(
  value: string,
  projectRoot: string | undefined,
): PilledCode | undefined {
  if (value.startsWith(skillMark)) return { skill: value.slice(1) };
  const n = sentToken.exec(value)?.[1];
  if (n) return { image: Number(n) };
  const file =
    (projectRoot && chatFileLink(value, projectRoot, true)) ||
    droppedFile(value);
  return file ? { file } : undefined;
}

/**
 * A file dropped into the composer goes in as its whole path in code, spaces
 * and all (`Q3 report.pdf`), which a path in an answer never gets.
 */
function droppedFile(value: string): ProjectFileLink | undefined {
  if (!/ /.test(value) || /[\n`]/.test(value) || !isOutsideFilePath(value))
    return undefined;
  return { path: value, directory: false, outside: true };
}

/** The screenshot numbers a sent message's text shows as pills. */
export function pilledImages(text: string) {
  const shown = new Set<number>();
  text.replace(pasteBlock, "").replace(codeOrToken, (m, code?: string) => {
    const n = sentToken.exec(code ? code.slice(1, -1) : m)?.[1];
    if (n) shown.add(Number(n));
    return m;
  });
  return shown;
}

type SentPart = string | { paste: PastedText } | { quote: string };
const fence = /(```[\s\S]*?(?:```|$))/;

/**
 * The message as the composer showed it: runs of text, and its pastes and
 * quotes as pills of their own. A blockquote outside code reads as a quote
 * pill: the composer's quote pill sends one, and a typed `>` means the same.
 */
function sentParts(text: string, skills: ReadonlySet<string>) {
  const parts: SentPart[] = [];
  let prose = "";
  const flush = () => {
    if (prose.trim()) parts.push(tokenAsCode(prose, skills));
    prose = "";
  };
  const quotes = (chunk: string) =>
    chunk.split(fence).forEach((segment, i) => {
      if (i % 2) return void (prose += segment);
      let last = 0;
      for (const m of segment.matchAll(quoteBlock)) {
        prose += segment.slice(last, m.index);
        flush();
        parts.push({ quote: unquote(m[0]) });
        last = m.index! + m[0].length;
      }
      prose += segment.slice(last);
    });
  let last = 0;
  for (const m of text.matchAll(pasteBlock)) {
    quotes(text.slice(last, m.index));
    flush();
    parts.push({ paste: { n: Number(m[1]), text: m[3] } });
    last = m.index! + m[0].length;
  }
  quotes(text.slice(last));
  flush();
  return parts;
}

const codeSpan = /```[\s\S]*?(?:```|$)|`([^`\n]*)`/g;

/** The skills, quotes and files a sent message shows as pills, for a copy of it to carry. */
export function sentPills(
  text: string,
  skills: SentSkill[] = [],
  projectRoot?: string,
): CopiedPills {
  const labels = new Map(skills.map((s) => [s.name, s.label]));
  const pills: CopiedPills = { skills: {}, quotes: [], files: [] };
  for (const part of sentParts(text, new Set(labels.keys()))) {
    if (typeof part !== "string") {
      if ("quote" in part) pills.quotes.push(part.quote);
      continue;
    }
    for (const [, code] of part.matchAll(codeSpan)) {
      // A fence matches without a span of its own: its code isn't pilled.
      if (code === undefined) continue;
      const pilled = pilledCode(code, projectRoot);
      if (pilled && "skill" in pilled)
        pills.skills[`$${pilled.skill}`] =
          labels.get(pilled.skill) ?? pilled.skill;
      else if (pilled && "file" in pilled) pills.files.push(code);
    }
  }
  return pills;
}

type SentCode = {
  labels: ReadonlyMap<string, string>;
  images: SentImage[];
  onOpenImage: (key: string) => void;
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
};

/** What a code span in a sent message shows instead of code, if anything. */
function shownCode(value: string, sent: SentCode) {
  const pilled = pilledCode(value, sent.projectRoot);
  if (!pilled) return undefined;
  if ("skill" in pilled) {
    const { skill } = pilled;
    const label = sent.labels.get(skill) ?? skill;
    return <Pill look={skillPill(`$${skill}`, label)} />;
  }
  if ("image" in pilled)
    return (
      <ImagePill
        sent={sent.images[pilled.image - 1]}
        n={pilled.image}
        onOpen={sent.onOpenImage}
      />
    );
  return sent.onOpenFile ? (
    <FilePill code={value} target={pilled.file} onOpen={sent.onOpenFile} />
  ) : undefined;
}

// Shared, so a message without skills or images doesn't make a new list each
// render: `inlineCode` would change with it, and RichText remount every pill.
const noSkills: SentSkill[] = [];
const noImages: SentImage[] = [];

/** A sent message's text in one box like the composer's, with the same pills where they went. */
export function UserText({
  text,
  skills = noSkills,
  images = noImages,
  onOpenImage,
  projectRoot,
  onOpenFile,
}: {
  text: string;
  /** The skills picked as pills when it was sent. */
  skills?: SentSkill[];
  /** In the order sent, which is the order the tokens number them. */
  images?: SentImage[];
  onOpenImage: (key: string) => void;
  /** Where file paths in code spans are looked up, to pill the ones that are files. */
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
}) {
  const labels = useMemo(
    () => new Map(skills.map((s) => [s.name, s.label])),
    [skills],
  );
  const parts = useMemo(
    () => sentParts(text, new Set(labels.keys())),
    [text, labels],
  );
  const inlineCode = useCallback(
    (value: string) =>
      shownCode(value, {
        labels,
        images,
        onOpenImage,
        projectRoot,
        onOpenFile,
      }),
    [images, onOpenImage, labels, projectRoot, onOpenFile],
  );
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const tip = useQuoteTip(box);
  if (!parts.length) return null;
  return (
    <div
      className="user-text"
      ref={setBox}
      // A copied selection keeps what its pills stand for, and a draft makes pills of them again.
      onCopy={(event) => copyWithPills(event.nativeEvent, event.currentTarget)}
    >
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <RichText key={i} text={part} inlineCode={inlineCode} typed />
        ) : (
          <p key={i} className="message-pill">
            {"quote" in part ? (
              <QuotePill quote={part.quote} />
            ) : (
              <PastedTextPill paste={part.paste} />
            )}
          </p>
        ),
      )}
      {tip && <QuoteTooltip tip={tip} />}
    </div>
  );
}
