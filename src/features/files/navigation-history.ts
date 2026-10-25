import { tabId, type EditorTab } from "./editor-tabs";

/** A place the caret was: a tab, and a 1-based line and column in it. */
export type Place = { tab: EditorTab; line: number; column: number };

export type History = { back: Place[]; forward: Place[] };

/** Places kept to go back to. */
const MAX_PLACES = 60;

/** The same line of the same file, wherever the caret was in it. */
const samePlace = (a: Place | undefined, b: Place) =>
  !!a && tabId(a.tab) === tabId(b.tab) && a.line === b.line;

export const emptyHistory: History = { back: [], forward: [] };

/** Moving from `from` to somewhere new: Back returns to `from`, and Forward is cleared. */
export function leave(history: History, from: Place | undefined): History {
  if (!from || samePlace(history.back.at(-1), from))
    return { back: history.back, forward: [] };
  return { back: [...history.back, from].slice(-MAX_PLACES), forward: [] };
}

/** One step back from `here`, or none to take. */
export function stepBack(history: History, here: Place | undefined) {
  const to = history.back.at(-1);
  if (!to) return;
  return {
    to,
    history: {
      back: history.back.slice(0, -1),
      forward: here ? [...history.forward, here] : history.forward,
    },
  };
}

/** One step forward from `here`, or none to take. */
export function stepForward(history: History, here: Place | undefined) {
  const to = history.forward.at(-1);
  if (!to) return;
  return {
    to,
    history: {
      back: here ? [...history.back, here] : history.back,
      forward: history.forward.slice(0, -1),
    },
  };
}

/** Drops places in a closed tab or a trashed folder, which can't be returned to. */
export function forget(
  history: History,
  gone: (tab: EditorTab) => boolean,
): History {
  return {
    back: history.back.filter((p) => !gone(p.tab)),
    forward: history.forward.filter((p) => !gone(p.tab)),
  };
}
