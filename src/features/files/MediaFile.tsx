import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileImage, GitCompare } from "lucide-react";
import type { FileInfo } from "../../../shared/project-files";
import type { Side } from "../../../shared/types";
import {
  isUnstaged,
  isStaged,
  type ChangeArea,
  type WorkingChange,
} from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { ImageFile, VideoFile } from "./FileViews";
import { MediaChange, mediaOf } from "./MediaChange";

type MediaProps = {
  active: boolean;
  where: string;
  info: FileInfo;
  lead?: ReactNode;
  shownPath?: string;
};

/**
 * A picture or video on disk. One with uncommitted changes can show them
 * before and after instead, and does when it was opened to show them.
 */
export function MediaFile({
  change,
  opened,
  ...media
}: MediaProps & {
  /** The file's uncommitted change, if it has one. */
  change?: WorkingChange;
  /** How the tab was last asked to open, again each time. */
  opened?: { changes?: boolean; nonce: number };
}) {
  const [comparing, setComparing] = useState(!!opened?.changes);
  const askedForChanges = !!opened?.changes;
  useEffect(() => {
    if (askedForChanges) setComparing(true);
  }, [askedForChanges, opened?.nonce]);
  if (comparing && change)
    return (
      <LocalMediaChange
        {...media}
        change={change}
        onShowFile={() => setComparing(false)}
      />
    );
  const showChanges = change && (
    <IconButton label="Show changes" onClick={() => setComparing(true)}>
      <GitCompare size={15} />
    </IconButton>
  );
  return media.info.kind === "video" ? (
    <VideoFile {...media} actions={showChanges} />
  ) : (
    <ImageFile {...media} actions={showChanges} />
  );
}

/** The file's uncommitted change, from the last version Git keeps to the file now. */
function LocalMediaChange({
  where,
  info,
  lead,
  shownPath = info.path,
  change,
  onShowFile,
}: MediaProps & { change: WorkingChange; onShowFile: () => void }) {
  const { area, sides } = localSides(change);
  const diff = useQuery({
    queryKey: ["media-change", where, info.path, area, change.stamp, info.mtime],
    queryFn: () => api.projectWorkingDiff(where, info.path, area),
    gcTime: 0,
  });
  if (diff.error) return <ErrorBox error={diff.error} />;
  if (!diff.data) return <Loading text="Reading the last version…" />;
  const media = mediaOf(diff.data);
  if (!media) return <ErrorBox error={new Error("Git didn’t keep this file as a picture or video.")} />;
  return (
    <MediaChange lead={lead} path={shownPath} media={media} sides={sides}>
      <IconButton label="Show the file" onClick={onShowFile}>
        <FileImage size={15} />
      </IconButton>
    </MediaChange>
  );
}

/**
 * Which of a change's diffs ends at the file on disk, and what its sides are:
 * staged and nothing since compares with HEAD; changed on disk compares with
 * what's staged, which is HEAD when nothing is.
 */
function localSides(change: WorkingChange): { area: ChangeArea; sides: Record<Side, string> } {
  if (!isUnstaged(change))
    return { area: "staged", sides: { deletions: "HEAD", additions: "Now" } };
  const before = isStaged(change) ? "Staged" : "HEAD";
  return { area: "unstaged", sides: { deletions: before, additions: "Now" } };
}
