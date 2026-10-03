/**
 * Undo for actions ⌘Z can take back for a moment, like settling a thread.
 * Every action claims what it changes; a newer claim on any of it makes the
 * older undo stale, so an undo can never reverse what came after it.
 */
export interface Undo {
  token: number;
  /** When it can no longer be undone. */
  until: number;
}

interface Entry extends Undo {
  keys: string[];
  run: () => Promise<void>;
}

/** How long an action stays undoable. */
export const UNDO_MS = 8000;
/** How many undos wait behind the newest, each with its own time. */
const KEEP = 5;

export function undoStack() {
  let last = 0;
  /** Each key's newest claim. */
  const owners = new Map<string, number>();
  let entries: Entry[] = [];
  let shown: Undo[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    shown = entries.map(({ token, until }) => ({ token, until }));
    for (const listener of listeners) listener();
  };
  const current = (e: Entry) => e.keys.every((k) => owners.get(k) === e.token);
  const keepOnly = (keep: (e: Entry) => boolean) => {
    const next = entries.filter(keep);
    if (next.length === entries.length) return;
    entries = next;
    changed();
  };
  const claim = (keys: string[]) => {
    const token = ++last;
    for (const key of keys) owners.set(key, token);
    keepOnly(current);
    return token;
  };
  return {
    /**
     * Marks a new action on `keys`, every one an undo of it would put back;
     * any older undo touching them goes.
     */
    claim,
    /**
     * Offers `run` to undo the action `token` claimed, unless a newer one
     * claimed any of `keys` since.
     */
    offer(
      token: number,
      keys: string[],
      run: () => Promise<void>,
      now = Date.now(),
    ) {
      const entry: Entry = { token, keys, until: now + UNDO_MS, run };
      if (!current(entry)) return;
      entries = [...entries, entry].slice(-KEEP);
      changed();
    },
    /** The action failed or was taken back some other way: nothing to undo. */
    drop(token: number) {
      keepOnly((e) => e.token !== token);
    },
    /**
     * Runs the undo of `token`, or the newest one, if it is still current.
     * The undo is itself a new action on the same keys. Resolves false when
     * there was nothing to undo.
     */
    async undo(token = entries.at(-1)?.token) {
      const entry = entries.find((e) => e.token === token);
      if (!entry || !current(entry)) return false;
      claim(entry.keys);
      await entry.run();
      return true;
    },
    /** Undos whose time is up go, `now` being the time. */
    expire(now = Date.now()) {
      keepOnly((e) => e.until > now);
    },
    /** Oldest first. */
    list: () => shown,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type UndoStack = ReturnType<typeof undoStack>;

/** The window's one stack, shared by every action that can be undone. */
export const undos = undoStack();
