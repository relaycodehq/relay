import { useState } from "react";
import type { FilePair, Side } from "../../shared/types";

type Images = NonNullable<FilePair["images"]>;

/** Before and after of a changed image, side by side or stacked. */
export function ImageDiff({
  images,
  sideLabels,
  split,
}: {
  images: Images;
  sideLabels?: Record<Side, string>;
  split: boolean;
}) {
  return (
    <div className={`image-diff ${split ? "split" : "stacked"}`}>
      <ImageSide
        label={sideLabels?.deletions ?? "Before"}
        source={images.old}
        absent="Added in this change"
      />
      <ImageSide
        label={sideLabels?.additions ?? "After"}
        source={images.next}
        absent="Deleted in this change"
      />
    </div>
  );
}

function ImageSide({
  label,
  source,
  absent,
}: {
  label: string;
  source: string | null;
  absent: string;
}) {
  const [size, setSize] = useState<string>();
  return (
    <figure className="image-diff-side">
      <figcaption>
        <span>{label}</span>
        {size && <span className="muted">{size}</span>}
      </figcaption>
      <div className="image-diff-canvas">
        {source ? (
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
