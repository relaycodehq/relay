import { useEffect, useState } from "react";
import type { QuestionTarget } from "../../shared/questions";
import type { Pull, PullRef } from "../../shared/types";
import { useStoredFlag } from "./useStoredFlag";

const keyOf = (pull: Pull) => `${pull.owner}/${pull.name}#${pull.number}`;

/**
 * The Pull requests page's PR room: whether it's open, and lines from the
 * diff to discuss in it, which another PR drops.
 */
export function usePullRoom(selected: PullRef | null) {
  const [open, setOpen] = useStoredFlag("relay-room-open");
  const [target, setTarget] = useState<{
    key: string;
    value: QuestionTarget;
  } | null>(null);
  useEffect(
    () => setTarget(null),
    [selected?.owner, selected?.name, selected?.number],
  );
  return {
    open,
    setOpen,
    /** Opens the room on `value`, lines of `pull`'s diff. */
    discuss(pull: Pull, value: QuestionTarget) {
      setTarget({ key: keyOf(pull), value });
      setOpen(true);
    },
    targetFor: (pull: Pull) =>
      target?.key === keyOf(pull) ? target.value : null,
    clearTarget: () => setTarget(null),
  };
}
