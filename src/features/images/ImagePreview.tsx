import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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

/**
 * The images that haven't failed to load, so a missing file leaves no broken
 * tile. `keep` stays in regardless: the one open in the viewer, which says why.
 */
export function useWorkingImages(images: PreviewImage[], keep?: string) {
  const failed = useQueries({
    // Only watches; each image loads when something first shows it.
    queries: images.map((image) => ({ ...imageQuery(image), enabled: false })),
    combine: (results) => results.map((result) => result.isError),
  });
  return useMemo(
    () => images.filter((image, i) => !failed[i] || image.key === keep),
    [images, failed, keep],
  );
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
  const { data: source, isError } = useImageSource(image, visible);
  if (isError) return null;
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
      ) : (
        <span>Loading image…</span>
      )}
    </div>
  );
}

/** An image an answer embeds, drawn where the text puts it; nothing at all if it won't load. */
export function AnswerImage({
  image,
  alt,
  onOpen,
}: {
  image: PreviewImage;
  alt: string;
  onOpen: () => void;
}) {
  const { data: source } = useImageSource(image);
  if (!source) return null;
  return (
    <CopyImageMenu source={source} inline className="answer-image">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${alt || image.name}`}
        title={image.location ?? image.name}
      >
        <img src={source} alt={alt || image.name} />
      </button>
    </CopyImageMenu>
  );
}
