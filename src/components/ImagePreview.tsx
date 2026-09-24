import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CopyImageMenu } from "./CopyImageMenu";

/** An image in the thread, fetched as a data URL the first time something shows it. */
export interface PreviewImage {
  /** Shared by the thumbnail, the viewer and its filmstrip, so the image loads once. */
  key: string;
  name: string;
  /** The file on disk, for an image the agent read. */
  path?: string;
  /** How the path reads in the viewer, relative to the project where it's inside it. */
  location?: string;
  load: () => Promise<string>;
  reveal?: () => Promise<void>;
}

export const imageQuery = (image: PreviewImage) => ({
  queryKey: ["preview-image", image.key],
  queryFn: image.load,
  staleTime: Infinity,
  retry: false,
});

export function useImageSource(image: PreviewImage, enabled = true) {
  return useQuery({ ...imageQuery(image), enabled });
}

/** A thumbnail that loads once scrolled near and opens the image in the viewer. */
export function ImageThumbnail({
  image,
  onOpen,
}: {
  image: PreviewImage;
  onOpen: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
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
  const { data: source, error } = useImageSource(image, visible);
  return (
    <div ref={container} className="message-image">
      {source ? (
        <CopyImageMenu source={source}>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${image.name}`}
            title={image.location ?? image.name}
          >
            <img src={source} alt={image.name} loading="lazy" />
          </button>
        </CopyImageMenu>
      ) : error ? (
        // Still opens, so the viewer can say why and offer to try again.
        <button
          type="button"
          className="message-image-missing"
          onClick={onOpen}
          title={error.message}
        >
          Image unavailable
        </button>
      ) : (
        <span>Loading image…</span>
      )}
    </div>
  );
}
