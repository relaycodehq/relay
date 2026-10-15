import { createContext, useContext, useRef } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import type { ChatImage } from "../../../shared/projects";
import {
  linesOf,
  type ProjectFileLink,
} from "../../../shared/project-file-links";
import { imageToken } from "../../../shared/image-refs";
import { formatSize } from "../../lib/file-tree";
import { useImageSource, type PreviewImage } from "../images/ImagePreview";
import { ImagePeek, PEEK_DELAY } from "../images/ImagePeek";
import { copiedPill } from "../images/image-clipboard";
import {
  filePill,
  imagePill,
  Pill,
  pillClass,
  PillButton,
  quotePill,
} from "../composer/prompt/Pill";

// The composer's pills as a sent message shows them, opening what they stand for.

export interface SentImage {
  image: ChatImage;
  preview: PreviewImage;
}

/** A screenshot, or where one was when it didn't come with the message. */
export function ImagePill({
  sent,
  n,
  onOpen,
}: {
  sent: SentImage | undefined;
  n: number;
  onOpen: (key: string) => void;
}) {
  if (sent) return <SentImagePill sent={sent} n={n} onOpen={onOpen} />;
  return (
    <span
      className={pillClass("image", "missing")}
      title="This screenshot didn't come with the message"
      data-copy=""
    >
      <span className="prompt-pill-thumb" aria-hidden="true" />
      <span className="prompt-pill-label">{imagePill(n, undefined).label}</span>
    </span>
  );
}

/** A screenshot, opening in the viewer; its picture grows out of it on hover. */
function SentImagePill({
  sent: { image, preview },
  n,
  onOpen,
}: {
  sent: SentImage;
  n: number;
  onOpen: (key: string) => void;
}) {
  const { data: source } = useImageSource(preview);
  const { pasted, label } = imagePill(n, image.name);
  const peek = useRef<PreviewCard.Root.Actions>(null);
  return (
    <PreviewCard.Root actionsRef={peek}>
      <PreviewCard.Trigger
        delay={PEEK_DELAY}
        closeDelay={0}
        render={
          <button
            type="button"
            className={pillClass("image", pasted && "pasted")}
            data-copy={imageToken(n)}
            title={`${image.name} · ${formatSize(image.sizeBytes)}, sent as ${imageToken(n)}`}
            aria-label={`Open ${pasted ? `Image #${n}` : image.name}`}
            onClick={() => onOpen(preview.key)}
          />
        }
      >
        {source ? (
          <img
            className="prompt-pill-thumb"
            src={source}
            {...copiedPill(n, image.name)}
          />
        ) : (
          <span className="prompt-pill-thumb" aria-hidden="true" />
        )}
        {label && <span className="prompt-pill-label">{label}</span>}
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

/** A file the message names in inline code, opening like the thread's other file links. */
export function FilePill({
  code,
  target,
  onOpen,
}: {
  /** The code span as written, which a copy brings back. */
  code: string;
  target: ProjectFileLink;
  onOpen: (target: ProjectFileLink) => void;
}) {
  const shown = filePill(target.directory ? `${target.path}/` : target.path);
  const lines = linesOf(target, "–");
  return (
    <PillButton
      look={{
        ...filePill(code),
        kind: shown.kind,
        label: shown.label,
        ...(lines ? { detail: `L${lines}` } : {}),
      }}
      title={`${target.path}${lines ? `:${linesOf(target, "-")}` : ""}`}
      onClick={() => onOpen(target)}
    />
  );
}

/** Takes the reader to where a quote was taken from, given the pill clicked. */
export const QuoteJump = createContext<
  ((quote: string, pill: HTMLElement) => void) | null
>(null);

/** A quoted passage, taking the reader back to it where the thread can. */
export function QuotePill({ quote }: { quote: string }) {
  const jump = useContext(QuoteJump);
  const look = quotePill(quote);
  if (!jump) return <Pill look={look} />;
  return (
    <PillButton
      look={look}
      aria-label={`Go to the quoted passage: ${look.label}`}
      onClick={(event) => jump(quote, event.currentTarget)}
    />
  );
}
