import { useState } from "react";
import { ImageOff, X } from "lucide-react";
import type { BrowserAnnotation } from "../../../shared/browser-annotations";
import { useImageSource, type PreviewImage } from "./ImagePreview";
import { ImageViewer } from "./ImageViewer";
import "./browser-annotation.css";

function targetLabel(annotation: BrowserAnnotation) {
  const tag = annotation.tag.match(/^<([\w-]+)/)?.[1]?.toLowerCase();
  const kind =
    tag && /^h[1-6]$/.test(tag)
      ? "Heading"
      : tag === "img" || tag === "svg" || tag === "canvas"
        ? "Image"
        : tag === "button"
          ? "Button"
          : tag === "a"
            ? "Link"
            : tag === "input" || tag === "textarea" || tag === "select"
              ? "Field"
              : "Page element";
  return annotation.text ? `${kind} · ${annotation.text}` : kind;
}

/** Feedback stays legible; page metadata is sent behind the scenes. */
export function BrowserAnnotationChip({
  annotation,
  image,
  onOpen,
  onRemove,
}: {
  annotation: BrowserAnnotation;
  image: PreviewImage;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const { data: source, isError } = useImageSource(image);
  const [viewing, setViewing] = useState(false);
  const label = targetLabel(annotation);
  return (
    <>
      <div className="browser-annotation-chip">
        <button
          type="button"
          className="browser-annotation-preview"
          aria-label={`Open screenshot: ${label}`}
          onClick={onOpen ?? (() => setViewing(true))}
        >
          {source ? (
            <img src={source} alt={`Screenshot of ${label}`} />
          ) : isError ? (
            <ImageOff size={18} aria-hidden />
          ) : null}
        </button>
        <div className="browser-annotation-copy">
          <small title={label}>{label}</small>
          <span>{annotation.comment}</span>
        </div>
        {onRemove && (
          <button
            type="button"
            className="browser-annotation-remove"
            aria-label={`Remove browser comment: ${annotation.comment}`}
            onClick={onRemove}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {viewing && (
        <ImageViewer
          images={[image]}
          index={0}
          onIndex={() => {}}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  );
}
