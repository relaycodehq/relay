import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangedFile, Progress } from "../../../shared/types";
import { toggleViewed } from "./review-progress";
import { useShortcut } from "../../lib/shortcuts";
import type { ReviewProgressController } from "./useReviewProgress";

/**
 * Stepping through a review's files: J and K move, V marks the file viewed
 * and moves on to the next unviewed one. A viewed file stays folded until
 * it's expanded, and folds again once you leave it.
 */
export function useReviewSteps(
  files: ChangedFile[],
  file: ChangedFile | undefined,
  revision: string,
  { progress, initial, update }: ReviewProgressController,
  onFileViewed: (path: string, progress: Progress) => void,
  onSelectFile: (path: string) => void,
  /** The keys work while the files show, not the conversation. */
  keys: boolean,
) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const current = useRef(progress);
  current.current = progress;
  useEffect(() => setExpanded(null), [file?.filename]);
  const toggleRead = useCallback(() => {
    if (!file || !initial.isSuccess) return;
    setExpanded(null);
    const markingRead = current.current.read[file.filename] !== revision;
    const next = update((p) => toggleViewed(p, file.filename, revision));
    if (markingRead) onFileViewed(file.filename, next);
    else onSelectFile(file.filename);
  }, [file, revision, update, initial.isSuccess, onFileViewed, onSelectFile]);
  const index = files.findIndex((f) => f.filename === file?.filename);
  const move = (n: number) => {
    const next = files[index + n];
    if (next) {
      setExpanded(null);
      onSelectFile(next.filename);
    }
  };
  useShortcut("review-read", keys, toggleRead);
  useShortcut("review-next", keys, () => move(1), { repeat: true });
  useShortcut("review-prev", keys, () => move(-1), { repeat: true });
  return {
    index,
    move,
    toggleRead,
    /** The viewed file shown in full anyway. */
    expanded,
    setExpanded,
  };
}
