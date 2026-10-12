import { useCallback, useMemo, useRef } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { pasteBlock, type PastedText } from "../../../shared/pasted-texts";
import type { ChatImage } from "../../../shared/projects";
import { formatSize } from "../../lib/file-tree";
import {
  imageToken,
  isPastedImageName,
  shortImageName,
} from "../../../shared/image-refs";
import { useImageSource, type PreviewImage } from "../images/ImagePreview";
import { ImagePeek, PEEK_DELAY } from "../images/ImagePeek";
import { PastedTextPill } from "../composer/PastedTextCard";
import { RichText } from "../../ui/RichText";
import { skillMentions, type SentSkill } from "../../../shared/skill-mentions";
import "../composer/prompt/prompt-input.css";

export interface SentImage {
  image: ChatImage;
  preview: PreviewImage;
}

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

/** A sent message's text, with each paste and screenshot shown as a pill where it went. */
export function UserText({
  text,
  skills = [],
  images = [],
  onOpenImage,
}: {
  text: string;
  /** The skills picked as pills when it was sent. */
  skills?: SentSkill[];
  /** In the order sent, which is the order the tokens number them. */
  images?: SentImage[];
  onOpenImage: (key: string) => void;
}) {
  const labels = useMemo(
    () => new Map(skills.map((s) => [s.name, s.label])),
    [skills],
  );
  const parts = useMemo(() => {
    const names = new Set(labels.keys());
    const parts: (string | PastedText)[] = [];
    let last = 0;
    for (const m of text.matchAll(pasteBlock)) {
      parts.push(tokenAsCode(text.slice(last, m.index), names));
      parts.push({ n: Number(m[1]), text: m[3] });
      last = m.index! + m[0].length;
    }
    parts.push(tokenAsCode(text.slice(last), names));
    return parts;
  }, [text, labels]);
  const inlineCode = useCallback(
    (value: string) => {
      if (value.startsWith(skillMark)) {
        const name = value.slice(1);
        return (
          <span className="composer-skill-chip" title={`$${name}`}>
            <span className="composer-skill-icon" aria-hidden="true" />
            <span>{labels.get(name) ?? name}</span>
          </span>
        );
      }
      const n = sentToken.exec(value)?.[1];
      if (!n) return undefined;
      const sent = images[Number(n) - 1];
      return sent ? (
        <ImagePill sent={sent} n={Number(n)} onOpen={onOpenImage} />
      ) : (
        <span
          className="composer-skill-chip composer-file-chip composer-image-chip missing"
          title="This screenshot didn't come with the message"
        >
          <span className="composer-image-chip-thumb" aria-hidden="true" />
          <span>Image #{n}</span>
        </span>
      );
    },
    [images, onOpenImage, labels],
  );
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part.trim() ? (
            <RichText
              key={i}
              text={part}
              inlineCode={inlineCode}
              typed
            />
          ) : null
        ) : (
          <p key={i} className="message-paste">
            <PastedTextPill paste={part} />
          </p>
        ),
      )}
    </>
  );
}

/** The composer's screenshot pill, opening the image in the viewer. */
function ImagePill({
  sent: { image, preview },
  n,
  onOpen,
}: {
  sent: SentImage;
  n: number;
  onOpen: (key: string) => void;
}) {
  const { data: source } = useImageSource(preview);
  const pasted = isPastedImageName(image.name);
  const peek = useRef<PreviewCard.Root.Actions>(null);
  return (
    <PreviewCard.Root actionsRef={peek}>
      <PreviewCard.Trigger
        delay={PEEK_DELAY}
        closeDelay={0}
        render={
          <button
            type="button"
            className={`composer-skill-chip composer-file-chip composer-image-chip message-image-chip${pasted ? " pasted" : ""}`}
            title={`${image.name} · ${formatSize(image.sizeBytes)}, sent as ${imageToken(n)}`}
            aria-label={`Open ${pasted ? `Image #${n}` : image.name}`}
            onClick={() => onOpen(preview.key)}
          />
        }
      >
        {source ? (
          <img className="composer-image-chip-thumb" src={source} alt="" />
        ) : (
          <span className="composer-image-chip-thumb" aria-hidden="true" />
        )}
        {!pasted && <span>{shortImageName(image.name)}</span>}
      </PreviewCard.Trigger>
      {source && (
        <ImagePeek
          src={source}
          onOpen={() => {
            peek.current?.close();
            onOpen(preview.key);
          }}
        />
      )}
    </PreviewCard.Root>
  );
}
