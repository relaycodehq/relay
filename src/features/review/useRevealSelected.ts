import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ChangeGroup } from "../../../shared/triage";
import type { Row } from "./file-list-rows";
import type { FileSelection } from "./usePullSelection";

/**
 * Scrolls the list to a selection that asks to be revealed, first opening
 * the Viewed fold or the group it's hidden in.
 */
export function useRevealSelected({
  selection,
  revision,
  rows,
  groups,
  plain,
  open,
  filter,
  folded,
  viewedOpen,
  setOpen,
  setViewedOpen,
  virtual,
}: {
  selection: FileSelection;
  revision: string;
  rows: Row[];
  groups: ChangeGroup[];
  plain: boolean;
  open: Set<string>;
  filter: string;
  folded: Set<string>;
  viewedOpen: boolean;
  setOpen: Dispatch<SetStateAction<Set<string>>>;
  setViewedOpen: Dispatch<SetStateAction<boolean>>;
  virtual: Virtualizer<HTMLDivElement, Element>;
}) {
  const selected = selection.path;
  const revealed = useRef<{
    selection: FileSelection;
    revision: string;
  } | null>(null);
  useEffect(() => {
    // Row changes are not navigation. Keep a request pending only until its
    // metadata/group becomes available, then consume it once.
    if (
      !selection.reveal ||
      !selected ||
      (revealed.current?.selection === selection &&
        revealed.current.revision === revision)
    )
      return;
    if (folded.has(selected) && !viewedOpen && !filter) {
      setViewedOpen(true);
      return;
    }
    const group = !plain && groups.find((g) => g.paths.includes(selected));
    if (group && !open.has(group.id) && !filter) {
      setOpen((prev) => new Set([...prev, group.id]));
      return;
    }
    const index = rows.findIndex(
      (r) => r.type === "file" && r.file.filename === selected,
    );
    if (index >= 0) {
      revealed.current = { selection, revision };
      // A new selection can resize the controls above the list; wait a frame
      // so the virtualizer has seen the list's new height before scrolling.
      requestAnimationFrame(() =>
        virtual.scrollToIndex(index, { align: "auto" }),
      );
    }
  }, [
    selection,
    selected,
    revision,
    rows,
    groups,
    open,
    plain,
    filter,
    folded,
    viewedOpen,
    virtual,
    setOpen,
    setViewedOpen,
  ]);
}
