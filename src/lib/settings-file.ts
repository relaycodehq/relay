import { useSyncExternalStore } from "react";
import type {
  SettingsEdit,
  SettingsFileState,
} from "../../shared/settings-file";

/**
 * settings.json in the page: read once as it starts, so the first frame
 * already has its fonts and theme, then followed as a script, an editor or
 * another window changes it. Each preference kept there is a `fileSetting`.
 */

const empty: SettingsFileState = { path: "", values: {} };
const bridge = typeof window === "undefined" ? undefined : window.relay;

function atStart(): SettingsFileState {
  try {
    const state: unknown = bridge?.settingsFileAtStart?.();
    return isObject(state) && isObject(state.values)
      ? (state as unknown as SettingsFileState)
      : empty;
  } catch {
    return empty;
  }
}

let state = atStart();
/** Why the last save from this window didn't make it into the file. */
let saveError: string | undefined;
const listeners = new Set<() => void>();
const settings = new Set<(values: Record<string, unknown>) => void>();

/** Saves on their way; the file's news waits until they're through. */
let saving = 0;
/** The newest state the main process sent while saves were on their way. */
let newest: SettingsFileState | undefined;

function receive(next: SettingsFileState) {
  state = next;
  for (const setting of settings) setting(next.values);
  for (const listener of listeners) listener();
}

bridge?.onSettingsFile?.((next) => {
  if (saving) newest = next;
  else receive(next);
});

/**
 * Puts edits in the file. The window shows them already; what the file holds
 * after the last save in a row (another window's or a script's edits merged
 * in, or the old values if it couldn't be saved) is what it shows next.
 */
async function save(edits: SettingsEdit[]) {
  if (!bridge?.updateSettingsFile) return false;
  saving++;
  try {
    newest = await bridge.updateSettingsFile(edits);
    saveError = undefined;
    return true;
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    if (!--saving) {
      const next = newest ?? state;
      newest = undefined;
      receive(next);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function at(value: unknown, path: string[]): unknown {
  let here = value;
  for (const key of path) {
    if (!isObject(here)) return undefined;
    here = here[key];
  }
  return here;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The edits that turn `before` into `after` under `path`, key by key, so
 * whatever else the file holds there (comments, keys this Relay doesn't
 * know) stays.
 */
export function editsBetween(
  before: unknown,
  after: unknown,
  path: string[],
): SettingsEdit[] {
  if (isObject(after) || (isObject(before) && after === undefined)) {
    const from = isObject(before) ? before : {};
    const to = isObject(after) ? after : {};
    return [...new Set([...Object.keys(from), ...Object.keys(to)])].flatMap(
      (key) => editsBetween(from[key], to[key], [...path, key]),
    );
  }
  if (same(before, after)) return [];
  return [{ path, value: after as SettingsEdit["value"] }];
}

/**
 * A preference kept in settings.json at `path`. `parse` reads what the file
 * holds there, undefined when nothing; `serialize` gives what to keep, only
 * what differs from the defaults. A `legacy` value from before the file moves
 * into it once, unless the file already has something there.
 */
export function fileSetting<T>(options: {
  path: string[];
  parse: (saved: unknown) => T;
  serialize: (value: T) => unknown;
  legacy?: { read: () => T | undefined; forget: () => void };
}) {
  const { path, parse, serialize, legacy } = options;
  const own = new Set<() => void>();
  const notify = () => {
    for (const listener of own) listener();
  };
  let current = parse(at(state.values, path));

  if (legacy && bridge?.updateSettingsFile) {
    const old = legacy.read();
    if (old !== undefined && at(state.values, path) === undefined) {
      current = old;
      // Kept where it was until the file has it.
      const edits = editsBetween(undefined, serialize(old), path);
      if (edits.length)
        void save(edits).then((saved) => saved && legacy.forget());
      else legacy.forget();
    } else if (old !== undefined) legacy.forget();
  }

  settings.add((values) => {
    const next = parse(at(values, path));
    if (same(next, current)) return;
    current = next;
    notify();
  });

  const subscribe = (listener: () => void) => {
    own.add(listener);
    return () => own.delete(listener);
  };
  return {
    get: () => current,
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => current),
    set(next: T) {
      const edits = editsBetween(serialize(current), serialize(next), path);
      current = next;
      notify();
      if (edits.length) void save(edits);
    },
  };
}

/** Where the file is and whether it reads, for Settings. */
export function useSettingsFile() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function useSettingsFileSaveError() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => saveError,
  );
}

/** localStorage's value under `key` and a way to drop it, for `legacy`. */
export function storedBefore<T>(key: string, read: (raw: string) => T) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : read(raw);
      } catch {
        return undefined;
      }
    },
    forget() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing to move then.
      }
    },
  };
}
