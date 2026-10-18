import { useId } from "react";
import { ChevronRight, Images } from "lucide-react";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { IMAGE_STRIPS } from "../../lib/thread-storage";
import { ImageThumbnail, type PreviewImage } from "./ImagePreview";

/** Images inspected during an answer, folded by default and remembered per thread. */
export function AgentImageStrip({
  chatId,
  images,
  onOpen,
}: {
  chatId: string;
  images: PreviewImage[];
  onOpen: (image: PreviewImage) => void;
}) {
  const [expanded, setExpanded] = useStoredFlag(IMAGE_STRIPS + chatId);
  const id = useId();
  return (
    <div className="agent-image-strip">
      <button
        type="button"
        className="agent-image-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((open) => !open)}
      >
        <ChevronRight size={13} className="agent-image-chevron" />
        <Images size={14} />
        <span>
          Agent looked at {images.length}{" "}
          {images.length === 1 ? "image" : "images"}
        </span>
      </button>
      <div id={id} hidden={!expanded}>
        {expanded && (
          <div className="message-images">
            {images.map((image) => (
              <ImageThumbnail
                key={image.key}
                image={image}
                onOpen={() => onOpen(image)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
