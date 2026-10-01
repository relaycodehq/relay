// Projects' own icons, kept on the phone as files. The desktop sends an icon
// only when the phone's copy is missing or stale (by hash), so a check costs
// a few bytes; each file is named by its hash, so a new icon is a new uri.
import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import type { RemoteClient } from "../../../shared/remote-client";

type Entry = { hash: string | null; uri?: string };

const indexKey = "relay-project-icons";
/** Icons rarely change; a project the phone hasn't seen asks sooner. */
const fresh = 10 * 60_000;
const retry = 30_000;
const extensions: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

let icons: Record<string, Entry> = {};
let loading: Promise<void> | undefined;
let checked = 0;
/** Whose icons were last checked: another computer's are due at once. */
let checkedWith: RemoteClient["call"] | undefined;
let syncing = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

const folder = () => new Directory(Paths.document, "project-icons");

function remove(uri: string | undefined) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {}
}

/** The saved index, minus anything whose file the system cleared away. */
function load() {
  loading ??= AsyncStorage.getItem(indexKey)
    .then((saved) => {
      const index = saved ? (JSON.parse(saved) as Record<string, Entry>) : {};
      for (const [id, entry] of Object.entries(index))
        if (entry.uri && !new File(entry.uri).exists) delete index[id];
      icons = { ...index, ...icons };
      changed();
    })
    .catch(() => {});
  return loading;
}

async function sync(
  call: RemoteClient["call"],
  projectIds: string[],
): Promise<void> {
  await load();
  const missing = projectIds.some((id) => !(id in icons));
  if (call !== checkedWith) checked = 0;
  if (syncing || Date.now() - checked < (missing ? retry : fresh)) return;
  syncing = true;
  checkedWith = call;
  try {
    const known = Object.fromEntries(
      projectIds.filter((id) => id in icons).map((id) => [id, icons[id]!.hash]),
    );
    const updates = await call("projectIcons", known);
    const next = { ...icons };
    for (const [id, icon] of Object.entries(updates)) {
      const old = next[id]?.uri;
      next[id] = icon.hash
        ? { hash: icon.hash, uri: save(id, icon) }
        : { hash: null };
      remove(old);
    }
    // Projects removed on the computer take their icons with them.
    for (const id of Object.keys(next))
      if (!projectIds.includes(id)) {
        remove(next[id]!.uri);
        delete next[id];
      }
    icons = next;
    changed();
    await AsyncStorage.setItem(indexKey, JSON.stringify(icons));
  } catch {
    // An older desktop has no icons to give; the folders stay.
  } finally {
    checked = Date.now();
    syncing = false;
  }
}

function save(id: string, icon: { hash: string; dataUrl: string }) {
  const [, mime, data] =
    icon.dataUrl.match(/^data:([^;,]+);base64,(.*)$/s) ?? [];
  const extension = mime && extensions[mime];
  if (!extension || !data) return undefined;
  const dir = folder();
  dir.create({ idempotent: true, intermediates: true });
  const file = new File(dir, `${id}-${icon.hash}.${extension}`);
  file.write(data, { encoding: "base64" });
  return file.uri;
}

/** Keeps the icons of these projects current while the phone is connected. */
export function useProjectIconSync(
  call: RemoteClient["call"],
  online: boolean,
  projectIds: string[],
) {
  const key = projectIds.join(",");
  useEffect(() => {
    if (!online || !key) return;
    const ids = key.split(",");
    void sync(call, ids);
    // sync() decides when it's due; this only gives it the chance.
    const timer = setInterval(() => void sync(call, ids), retry);
    return () => clearInterval(timer);
  }, [call, online, key]);
}

/** The project's icon file, or undefined to show its folder. */
export function useProjectIcon(projectId: string) {
  useEffect(() => void load(), []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => icons[projectId]?.uri,
  );
}
