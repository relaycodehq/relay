import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CopyImageMenu } from "./CopyImageMenu";
import { startImageDrag } from "./image-drag";
import "./image-tiles.css";
import "./answer-media.css";

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
  // An answer can reach the renderer before main has saved the image's turn.
  retry: 2,
  retryDelay: 500,
});

export function useImageSource(image: PreviewImage, enabled = true) {
  return useQuery({ ...imageQuery(image), enabled });
}

/**
 * Hide tiles that never loaded, but keep cached images if a later read fails.
 * `keep` stays in regardless: the one open in the viewer, which says why.
 */
export function useWorkingImages(images: PreviewImage[], keep?: string) {
  const failed = useQueries({
    // Only watches; each image loads when something first shows it.
    queries: images.map((image) => ({ ...imageQuery(image), enabled: false })),
    combine: (results) =>
      results.map((result) => result.isError && !result.data),
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
  if (isError && !source) return null;
  return (
    <div ref={container} className="message-image">
      {source ? (
        <CopyImageMenu source={source}>
          <button
            type="button"
            onClick={onOpen}
            draggable
            onDragStart={(e) => startImageDrag(e, source, image.name)}
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

/** An embedded image keeps its place and can be retried when loading fails. */
export function AnswerImage({
  image,
  alt,
  onOpen,
}: {
  image: PreviewImage;
  alt: string;
  onOpen: () => void;
}) {
  const { data: source, error, refetch, isFetching } = useImageSource(image);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [failedSource, setFailedSource] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const broken = !!source && failedSource === source;
  return (
    <span
      className="answer-media-frame answer-image-frame"
      role="group"
      aria-label={alt || image.name}
      data-empty={!source || (broken && !size) || undefined}
      style={
        size
          ? {
              minWidth: `min(100%, ${size.width}px)`,
              aspectRatio: `${size.width} / ${size.height}`,
            }
          : undefined
      }
    >
      {source && (
        <CopyImageMenu source={source} inline className="answer-image">
          <button
            type="button"
            disabled={broken}
            onClick={onOpen}
            draggable
            onDragStart={(e) => startImageDrag(e, source, image.name)}
            aria-label={`Open ${alt || image.name}`}
            title={image.location ?? image.name}
          >
            <img
              key={attempt}
              src={source}
              alt={alt || image.name}
              onLoad={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setSize({
                  width: bounds.width,
                  height: bounds.height,
                });
                setFailedSource(undefined);
              }}
              onError={() => setFailedSource(source)}
            />
          </button>
        </CopyImageMenu>
      )}
      {(!source || broken) && (
        <span className="answer-media-error" role="status">
          <span>
            {!source && !error ? "Loading image…" : "This image couldn't load."}
          </span>
          {(error || broken) && (
            <button
              type="button"
              disabled={isFetching}
              onClick={async () => {
                const result = await refetch();
                if (result.isError) return;
                setFailedSource(undefined);
                setAttempt((count) => count + 1);
              }}
            >
              Retry image
            </button>
          )}
        </span>
      )}
    </span>
  );
}
