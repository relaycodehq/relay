import { useEffect, useRef, useState } from "react";
import type { PullRef } from "../../../shared/types";

export interface FileSelection {
  path: string | null;
  /** Explicit navigation reveals the file; bulk review keeps the list in place. */
  reveal: boolean;
}

/**
 * The PR under review and its file. Every new choice bumps `navigation`, so
 * a step still loading the next file drops its result once overtaken. With
 * `restore`, the PR reopened at launch waits in `restoring` until it's known
 * whether its review is still going.
 */
export function usePullSelection(
  initial: PullRef | null,
  initialFile: string | null,
  restore: boolean,
) {
  const [restoring, setRestoring] = useState(restore);
  const [selected, setSelected] = useState<PullRef | null>(initial),
    [fileSelection, setFileSelection] = useState<FileSelection>({
      path: initialFile,
      reveal: true,
    });
  const file = fileSelection.path;
  const setFile = (path: string | null, reveal = true) =>
    setFileSelection({ path, reveal });
  const navigation = useRef(0);
  const selectFile = (path: string) => {
    navigation.current++;
    setFile(path);
  };
  useEffect(
    () => () => {
      navigation.current++;
    },
    [],
  );
  const select = (r: PullRef) => {
    setRestoring(false);
    if (
      r.owner === selected?.owner &&
      r.name === selected.name &&
      r.number === selected.number
    )
      return;
    navigation.current++;
    setSelected(r);
    setFile(null);
  };
  const deselect = () => {
    setRestoring(false);
    navigation.current++;
    setSelected(null);
    setFile(null);
  };
  /** Ends restoring: the PR stays open while its review goes on. */
  const restored = (resume: boolean) => {
    if (!resume) {
      setSelected(null);
      setFile(null);
    }
    setRestoring(false);
  };
  return {
    selected,
    restoring,
    file,
    fileSelection,
    setFile,
    selectFile,
    select,
    deselect,
    restored,
    navigation,
  };
}
export type PullSelection = ReturnType<typeof usePullSelection>;
