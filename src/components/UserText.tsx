import { useCallback, useMemo } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { pasteBlock, type PastedText } from "../../shared/pasted-texts";
import type { ChatImage } from "../../shared/projects";
import { formatSize } from "../lib/file-tree";
import {
  imageToken,
  isPastedImageName,
  shortImageName,
} from "../lib/image-refs";
import { useImageSource, type PreviewImage } from "./ImagePreview";
import { ImagePeek, PEEK_DELAY } from "./ImagePeek";
import { PastedTextPill } from "./PastedTextCard";
import { RichText } from "./ui";

export interface SentImage {
  image: ChatImage;
  preview: PreviewImage;
}

// A token becomes inline code the pill replaces; one already in a code span is
// pilled as it stands (as the composer does), one in a fence stays text.
const codeOrToken = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)|\[Image #\d+\]/g;
const tokenAsCode = (text: string) =>
  text.replace(codeOrToken, (m, code?: string) => code ?? `\`${m}\``);
const sentToken = /^\[Image #(\d+)\]$/;

/** The screenshot numbers a sent message's text shows as pills. */
export function pilledImages(text: string) {
  const shown = new Set<number>();
  text
    .replace(pasteBlock, "")
    .replace(codeOrToken, (m, code?: string) => {
      const n = sentToken.exec(code ? code.slice(1, -1) : m)?.[1];
      if (n) shown.add(Number(n));
      return m;
    });
  return shown;
}

/** A sent message's text, with each paste and screenshot shown as a pill where it went. */
export function UserText({
  text,
  images = [],
  onOpenImage,
}: {
  text: string;
  /** In the order sent, which is the order the tokens number them. */
  images?: SentImage[];
  onOpenImage: (key: string) => void;
}) {
  const parts = useMemo(() => {
    const parts: (string | PastedText)[] = [];
    let last = 0;
    for (const m of text.matchAll(pasteBlock)) {
      parts.push(tokenAsCode(text.slice(last, m.index)));
      parts.push({ n: Number(m[1]), text: m[3] });
      last = m.index! + m[0].length;
    }
    parts.push(tokenAsCode(text.slice(last)));
    return parts;
  }, [text]);
  const inlineCode = useCallback(
    (value: string) => {
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
    [images, onOpenImage],
  );
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part.trim() ? (
            <RichText key={i} text={part} inlineCode={inlineCode} />
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
  return (
    <PreviewCard.Root>
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
      {source && <ImagePeek src={source} />}
    </PreviewCard.Root>
  );
}
