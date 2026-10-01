import { X } from "lucide-react";
import { flattenSketch } from "../lib/sketch";
import type { ComposerDraft } from "../lib/useComposerDraft";
import { CopyImageMenu } from "./CopyImageMenu";
import { SketchOverlay } from "./ImageSketch";
import { PastedTextCard } from "./PastedTextCard";

/** The draft's screenshots and long pastes, as cards above the input. */
export function ComposerAttachmentStrip({
  draft,
  onOpenPaste,
  onRemovePaste,
}: {
  draft: ComposerDraft;
  onOpenPaste: (index: number) => void;
  onRemovePaste: (index: number) => void;
}) {
  const { attached, pastes } = draft;
  if (!attached.length && !pastes.length) return null;
  return (
    <div className="composer-images" aria-label="Attachments">
      {attached.map((image) => (
        <CopyImageMenu
          className="composer-image"
          key={image.id}
          source={async () => (await flattenSketch(image)).dataUrl}
        >
          <button
            type="button"
            className="composer-image-open"
            aria-label={`Draw on ${image.name}`}
            title="Draw on screenshot"
            onClick={() => draft.sketch(image.id)}
          >
            <img src={image.dataUrl} alt={image.name} />
            {image.sketch && (
              <SketchOverlay sketch={image.sketch} src={image.dataUrl} />
            )}
          </button>
          <button
            type="button"
            className="composer-image-remove"
            disabled={draft.preparing}
            aria-label={`Remove ${image.name}`}
            onClick={() => draft.removeImage(image)}
          >
            <X size={13} />
          </button>
        </CopyImageMenu>
      ))}
      {pastes.map((paste, index) => (
        <PastedTextCard
          key={index}
          paste={paste}
          onOpen={() => onOpenPaste(index)}
          onRemove={() => onRemovePaste(index)}
        />
      ))}
    </div>
  );
}
