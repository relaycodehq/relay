import { useRef } from "react";
import type { ShellNavigation, Surface } from "./useShellNavigation";

/** What the shell shows: a project's open thread, or while none is, its unsent one. */
export interface ShellSpot {
  projectId?: string;
  chatId: string | null;
  draftId: string;
  surface: Surface;
}

export function sameSpot(a: ShellSpot, b: ShellSpot) {
  return (
    a.projectId === b.projectId &&
    a.surface === b.surface &&
    a.chatId === b.chatId &&
    (a.chatId !== null || a.draftId === b.draftId)
  );
}

/**
 * Where the shell is right now, for work that finishes later and should
 * only open its result if the user stayed put.
 */
export function useShellSpot(
  nav: Pick<ShellNavigation, "project" | "chatId" | "draftId" | "surface">,
) {
  const spot: ShellSpot = {
    projectId: nav.project?.id,
    chatId: nav.chatId,
    draftId: nav.draftId,
    surface: nav.surface,
  };
  const now = useRef(spot);
  now.current = spot;
  return () => now.current;
}
