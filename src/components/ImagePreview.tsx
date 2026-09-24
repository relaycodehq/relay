import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CopyImageMenu } from "./CopyImageMenu";
import { Modal } from "./ui";

/** An image in the thread, fetched as a data URL the first time something shows it. */
export interface PreviewImage {
  /** Shared by the thumbnail and its dialog, so the image loads once. */
  key: string;
  name: string;
  load: () => Promise<string>;
}

function useImageSource(image: PreviewImage, enabled = true) {
  return useQuery({
    queryKey: ["preview-image", image.key],
    queryFn: image.load,
    enabled,
    staleTime: Infinity,
  });
}

export function ImagePreviewDialog({
  image,
  onClose,
}: {
  image: PreviewImage;
  onClose: () => void;
}) {
  const { data: source, isError } = useImageSource(image);
  return (
    <Modal title={image.name} onClose={onClose} className="screenshot-dialog">
      {source ? (
        <CopyImageMenu source={source} inDialog>
          <img
            className="message-image-expanded"
            src={source}
            alt={image.name}
          />
        </CopyImageMenu>
      ) : (
        <p className="muted">
          {isError ? "Image unavailable" : "Loading image…"}
        </p>
      )}
    </Modal>
  );
}

/** A thumbnail that loads once scrolled near and opens the full image. */
export function ImageThumbnail({ image }: { image: PreviewImage }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "150px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const { data: source, isError } = useImageSource(image, visible);
  return (
    <>
      <div ref={container} className="message-image">
        {source ? (
          <CopyImageMenu source={source}>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`Open ${image.name}`}
              title={image.name}
            >
              <img src={source} alt={image.name} loading="lazy" />
            </button>
          </CopyImageMenu>
        ) : (
          <span>{isError ? "Image unavailable" : "Loading image…"}</span>
        )}
      </div>
      {/* Outside .message-image so the thumbnail's button and img rules don't reach the dialog. */}
      {expanded && (
        <ImagePreviewDialog image={image} onClose={() => setExpanded(false)} />
      )}
    </>
  );
}
