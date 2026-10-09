// Projects' own icons, kept on the phone as files. The desktop sends an icon
// only when the phone's copy is missing or stale (by hash), so a check costs
// a few bytes; each file is named by its hash, so a new icon is a new uri.
import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import type { RemoteClient } from "../../../shared/remote-client";
import {
  applyIconUpdates,
  iconsByProject,
  knownHashes,
  type IconIndex,
} from "./project-icon-index";

const indexKey = "relay-project-icons-by-computer";
/** The index from before it was kept per computer; its files go with it. */
const legacyKey = "relay-project-icons";
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

let index: IconIndex = {};
let icons = iconsByProject(index);
let loading: Promise<void> | undefined;
/** When each computer's icons were last checked. */
const checked = new Map<string, number>();
const syncing = new Set<string>();
const listeners = new Set<() => void>();

function update(next: IconIndex) {
  index = next;
  icons = iconsByProject(next);
  listeners.forEach((l) => l());
}

const folder = () => new Directory(Paths.document, "project-icons");
const computerFolder = (computer: string) => new Directory(folder(), computer);

function remove(uri: string | undefined) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {}
}

/** The saved index, minus anything whose file the system cleared away. */
function load() {
  loading ??= (async () => {
    if (await AsyncStorage.getItem(legacyKey)) {
      try {
        for (const item of folder().list()) if (item instanceof File) item.delete();
      } catch {}
      await AsyncStorage.removeItem(legacyKey);
    }
    const saved = await AsyncStorage.getItem(indexKey);
    const stored = saved ? (JSON.parse(saved) as IconIndex) : {};
    for (const mine of Object.values(stored))
      for (const [id, entry] of Object.entries(mine))
        if (entry.uri && !new File(entry.uri).exists) delete mine[id];
    // Whatever a sync already brought in wins.
    const merged = { ...stored };
    for (const [computer, mine] of Object.entries(index))
      merged[computer] = { ...stored[computer], ...mine };
    update(merged);
  })().catch(() => {});
  return loading;
}

async function sync(
  computer: string,
  call: RemoteClient["call"],
  projectIds: string[],
): Promise<void> {
  await load();
  const missing = projectIds.some((id) => !(id in (index[computer] ?? {})));
  if (
    syncing.has(computer) ||
    Date.now() - (checked.get(computer) ?? 0) < (missing ? retry : fresh)
  )
    return;
  syncing.add(computer);
  try {
    const updates = await call(
      "projectIcons",
      knownHashes(index, computer, projectIds),
    );
    const next = applyIconUpdates(index, computer, projectIds, updates, (id, icon) =>
      save(computer, id, icon),
    );
    next.unused.forEach(remove);
    update(next.index);
    await AsyncStorage.setItem(indexKey, JSON.stringify(index));
  } catch {
    // An older desktop has no icons to give; the folders stay.
  } finally {
    checked.set(computer, Date.now());
    syncing.delete(computer);
  }
}

function save(
  computer: string,
  id: string,
  icon: { hash: string; dataUrl: string },
) {
  const [, mime, data] =
    icon.dataUrl.match(/^data:([^;,]+);base64,(.*)$/s) ?? [];
  const extension = mime && extensions[mime];
  if (!extension || !data) return undefined;
  const dir = computerFolder(computer);
  dir.create({ idempotent: true, intermediates: true });
  const file = new File(dir, `${id}-${icon.hash}.${extension}`);
  file.write(data, { encoding: "base64" });
  return file.uri;
}

/** Keeps the icons of this computer's projects current while the phone is connected to it. */
export function useProjectIconSync(
  computer: string | undefined,
  call: RemoteClient["call"],
  online: boolean,
  projectIds: string[],
) {
  const key = projectIds.join(",");
  useEffect(() => {
    if (!computer || !online || !key) return;
    const ids = key.split(",");
    void sync(computer, call, ids);
    // sync() decides when it's due; this only gives it the chance.
    const timer = setInterval(() => void sync(computer, call, ids), retry);
    return () => clearInterval(timer);
  }, [computer, call, online, key]);
}

/** A forgotten computer's icons go with it. */
export async function forgetIcons(computer: string) {
  await load();
  if (!(computer in index)) return;
  const { [computer]: _, ...rest } = index;
  update(rest);
  checked.delete(computer);
  try {
    const dir = computerFolder(computer);
    if (dir.exists) dir.delete();
  } catch {}
  await AsyncStorage.setItem(indexKey, JSON.stringify(index)).catch(() => {});
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
