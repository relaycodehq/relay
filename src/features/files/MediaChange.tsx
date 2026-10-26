import type { ReactNode } from "react";
import type { FilePair, Side } from "../../../shared/types";
import { ImageDiff } from "../diff/ImageDiff";
import { SplitDiffToggle, useSplitDiff } from "../diff/WorkingDiff";
import { FileBar } from "./FileViews";

/** Both sides of a changed picture or video, and whether they play rather than show. */
export type MediaPair = {
  sources: { old: string | null; next: string | null };
  video: boolean;
};

/** The pictures or videos of a diff, when Git found its file to be one. */
export function mediaOf(pair: FilePair): MediaPair | undefined {
  if (pair.images) return { sources: pair.images, video: false };
  if (pair.videos) return { sources: pair.videos, video: true };
}

/** A changed picture or video before and after, in place of the file in a tab. */
export function MediaChange({
  lead,
  path,
  detail,
  media,
  sides,
  children,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  detail?: string;
  media: MediaPair;
  sides: Record<Side, string>;
  /** Actions at the end of the bar. */
  children?: ReactNode;
}) {
  const [split, setSplit] = useSplitDiff();
  return (
    <section className="image-file media-change" aria-label="Changes">
      <ImageDiff images={media.sources} video={media.video} sideLabels={sides} split={split} />
      <FileBar lead={lead} path={path} detail={detail}>
        <SplitDiffToggle split={split} onChange={setSplit} />
        {children}
      </FileBar>
    </section>
  );
}
