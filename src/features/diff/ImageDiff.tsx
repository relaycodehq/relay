import { useState } from "react";
import type { FilePair, Side } from "../../../shared/types";

type Images = NonNullable<FilePair["images"]>;

/** Before and after of a changed image or video, side by side or stacked. */
export function ImageDiff({
  images,
  video = false,
  sideLabels,
  split,
}: {
  images: Images;
  /** The sources are videos to play rather than pictures. */
  video?: boolean;
  sideLabels?: Record<Side, string>;
  split: boolean;
}) {
  return (
    <div className={`image-diff ${split ? "split" : "stacked"}`}>
      <ImageSide
        key={images.old ?? "old"}
        label={sideLabels?.deletions ?? "Before"}
        source={images.old}
        video={video}
        absent="Added in this change"
      />
      <ImageSide
        key={images.next ?? "next"}
        label={sideLabels?.additions ?? "After"}
        source={images.next}
        video={video}
        absent="Deleted in this change"
      />
    </div>
  );
}

function ImageSide({
  label,
  source,
  video,
  absent,
}: {
  label: string;
  source: string | null;
  video: boolean;
  absent: string;
}) {
  const [size, setSize] = useState<string>();
  const [failed, setFailed] = useState(false);
  return (
    <figure className="image-diff-side">
      <figcaption>
        <span>{label}</span>
        {size && <span className="muted">{size}</span>}
      </figcaption>
      <div className="image-diff-canvas">
        {source && video ? (
          failed ? (
            <span className="muted">This video won’t play here.</span>
          ) : (
            <video
              src={source}
              controls
              preload="metadata"
              aria-label={label}
              onLoadedMetadata={(e) =>
                setSize(
                  `${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`,
                )
              }
              onError={() => setFailed(true)}
            />
          )
        ) : source ? (
          <img
            src={source}
            alt={label}
            onLoad={(e) =>
              setSize(
                `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`,
              )
            }
          />
        ) : (
          <span className="muted">{absent}</span>
        )}
      </div>
    </figure>
  );
}
