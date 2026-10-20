import { z } from "zod";
import { DEFAULT_AUTO_SETTLE_DAYS } from "../../shared/chat-activity";
import { DEFAULT_WORKTREE_CLEANUP_DAYS } from "../../shared/projects";
import type { SettingsEdit } from "../../shared/settings-file";
import { watchScopes } from "../../shared/watch";
import type { Store } from "../app/store";
import type { SettingsFile } from "./settings-file";

/**
 * The preferences the main process acts on, which `relay settings` sets on
 * a headless Relay and Settings on the desktop. Days: null is never.
 */
const prefs = {
  keepAwake: { path: ["keepAwake"], schema: z.boolean(), default: true },
  autoSettleDays: {
    path: ["threads", "autoSettleDays"],
    schema: z.number().int().min(1).max(90).nullable(),
    default: DEFAULT_AUTO_SETTLE_DAYS as number | null,
  },
  worktreeCleanupDays: {
    path: ["threads", "worktreeCleanupDays"],
    schema: z.number().int().min(0).max(90).nullable(),
    default: DEFAULT_WORKTREE_CLEANUP_DAYS,
  },
  watchThreads: {
    path: ["threads", "watch"],
    schema: z.enum(watchScopes),
    default: "off" as (typeof watchScopes)[number],
  },
};

export type AppPrefs = {
  [K in keyof typeof prefs]: (typeof prefs)[K]["default"];
};
type Key = keyof AppPrefs;
const keys = Object.keys(prefs) as Key[];

export const defaultPrefs = Object.fromEntries(
  keys.map((key) => [key, prefs[key].default]),
) as AppPrefs;

function at(values: unknown, path: string[]) {
  let here = values;
  for (const key of path)
    here =
      here && typeof here === "object"
        ? (here as Record<string, unknown>)[key]
        : undefined;
  return here;
}

/** What the file says, or the default where it says nothing that reads. */
export function readPrefs(values: Record<string, unknown>): AppPrefs {
  return Object.fromEntries(
    keys.map((key) => {
      const read = prefs[key].schema.safeParse(at(values, prefs[key].path));
      return [key, read.success ? read.data : prefs[key].default];
    }),
  ) as AppPrefs;
}

/** Saves one preference; the default leaves the file. */
export function savePref<K extends Key>(
  file: SettingsFile,
  key: K,
  value: AppPrefs[K],
) {
  return file.update([edit(key, value)]);
}

function edit(key: Key, value: unknown): SettingsEdit {
  return {
    path: prefs[key].path,
    value: value === prefs[key].default ? undefined : (value as never),
  };
}

/**
 * Moves these out of state.json, where earlier builds kept them, unless the
 * file already says. They leave state.json once the file has them.
 */
export async function movePrefsToFile(store: Store, file: SettingsFile) {
  const saved = store.get() as Partial<Record<Key, unknown>>;
  const moving = keys.filter((key) => saved[key] !== undefined);
  if (!moving.length) return;
  const edits = moving
    .filter((key) => at(file.state().values, prefs[key].path) === undefined)
    .filter((key) => prefs[key].schema.safeParse(saved[key]).success)
    .map((key) => edit(key, saved[key]))
    .filter((e) => e.value !== undefined);
  if (edits.length) await file.update(edits);
  await store.update((s) => {
    for (const key of moving) delete (s as Partial<Record<Key, unknown>>)[key];
  });
}
