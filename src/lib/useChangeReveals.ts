import { useEffect, useState, type RefObject } from "react";
import type { ChangeArea, WorkingTree } from "../../shared/working-tree";
import { linksTo, type ProjectFileLink } from "../../shared/project-file-links";
import { useRequests, type RequestChannel } from "./request-channel";
import {
  revealArea,
  settleSelection,
  type SelectedChange,
} from "./working-changes";

/**
 * Keeps the selected diff on a list that still has it, and selects a file
 * asked for, such as one clicked in the chat, once the tree lists it: its
 * list opens, its row scrolls into view and its diff to the line. Until the
 * tree lists it, `missing` says it has no local changes.
 */
export function useChangeReveals({
  reveals,
  tree,
  selected,
  setSelected,
  onReveal,
  list,
}: {
  reveals?: RequestChannel<ProjectFileLink>;
  tree?: WorkingTree;
  selected: SelectedChange | null;
  setSelected: (next: SelectedChange | null) => void;
  /** Opens the list the revealed file is in. */
  onReveal: (area: ChangeArea) => void;
  list: RefObject<HTMLElement | null>;
}) {
  const [wanted, setWanted] = useState<ProjectFileLink | null>(null),
    [line, setLine] = useState<number>(),
    [revealed, setRevealed] = useState(0);
  useRequests(reveals, setWanted);
  const missing =
    wanted && tree && !tree.changes.some((c) => linksTo(wanted, c.path))
      ? wanted
      : null;
  useEffect(() => {
    if (!selected || !tree) return;
    const next = settleSelection(selected, tree.changes);
    if (next !== selected) setSelected(next);
  }, [tree, selected]);
  useEffect(() => {
    if (!wanted || !tree) return;
    const change = tree.changes.find((c) => linksTo(wanted, c.path));
    if (!change) {
      setSelected(null);
      return;
    }
    const area = revealArea(change);
    setSelected({ path: change.path, area });
    onReveal(area);
    setLine(wanted.directory ? undefined : wanted.line);
    setWanted(null);
    setRevealed((n) => n + 1);
  }, [wanted, tree]);
  useEffect(() => {
    if (revealed)
      list.current
        ?.querySelector(".working-file.selected")
        ?.scrollIntoView({ block: "nearest" });
  }, [revealed]);
  /** Selects a file by hand, which drops a reveal still waiting. */
  const pick = (path: string, area: ChangeArea) => {
    setSelected({ path, area });
    setWanted(null);
    setLine(undefined);
  };
  return { missing, line, setLine, pick };
}
