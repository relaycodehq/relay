import type { EditorLayout } from "./editor-groups";
import { tabId, type EditorTab } from "./editor-tabs";

/** A tab that closed, and the split it was in. */
export type ClosedTab = { tab: EditorTab; group: string };

/** How many closed tabs Reopen Closed Tab can go back through. */
export const MAX_CLOSED = 20;

/** The tabs that were in `before` and aren't in `after`. */
export function tabsGone(before: EditorTab[], after: EditorTab[]) {
  const stillOpen = new Set(after.map(tabId));
  return before.filter((t) => !stillOpen.has(tabId(t)));
}

/**
 * The stack with `closed` on top, the last of them first. Closing the same
 * file in the same split again moves it up instead of listing it twice.
 */
export function rememberClosed(stack: ClosedTab[], closed: ClosedTab[]) {
  const seen = new Set<string>();
  return [...[...closed].reverse(), ...stack]
    .filter(({ tab, group }) => {
      const key = `${group}:${tabId(tab)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CLOSED);
}

/**
 * The tab to bring back and where: its own split if that still exists, else
 * the focused one. Entries already open there are skipped. `rest` is the
 * stack without what was used.
 */
export function nextToReopen(stack: ClosedTab[], layout: EditorLayout) {
  for (const [at, { tab, group }] of stack.entries()) {
    const into = layout.groups.find((g) => g.id === group)
      ? group
      : layout.focused;
    const open = layout.groups
      .find((g) => g.id === into)
      ?.tabs.some((t) => tabId(t) === tabId(tab));
    if (!open) return { tab, group: into, rest: stack.slice(at + 1) };
  }
  return undefined;
}
