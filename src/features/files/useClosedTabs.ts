import { useRef } from "react";
import type { EditorLayout } from "./editor-groups";
import { nextToReopen, rememberClosed, type ClosedTab } from "./closed-tabs";

/**
 * The tabs closed in this workspace, newest first, for Reopen Closed Tab.
 * Kept in memory only, and forgotten when the workspace changes.
 */
export function useClosedTabs(where: string) {
  const memory = useRef({ where, stack: [] as ClosedTab[] });
  if (memory.current.where !== where) memory.current = { where, stack: [] };
  return {
    remember: (closed: ClosedTab[]) => {
      if (closed.length)
        memory.current.stack = rememberClosed(memory.current.stack, closed);
    },
    /** Takes the tab to reopen off the stack, if there is one. */
    takeNext: (layout: EditorLayout) => {
      const next = nextToReopen(memory.current.stack, layout);
      if (next) memory.current.stack = next.rest;
      return next;
    },
  };
}

export type ClosedTabs = ReturnType<typeof useClosedTabs>;
