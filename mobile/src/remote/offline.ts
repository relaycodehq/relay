// What the phone last saw of the computer, so the lists and recent threads
// can still be read on a train. Written a little behind the live state and
// replaced by it as soon as the computer answers again.
import { Directory, File, Paths } from "expo-file-system";
import type { RemoteOverview, RemoteSettings } from "../../../shared/remote";
import type { ModelCatalogs } from "../../../shared/composer-commands";
import type { NewThreadModels } from "../../../shared/new-thread-models";
import type { Thread } from "./chat-state";

/** Threads kept for reading offline, most recently saved first. */
const keep = 20;
/** The most recent threads saved without being opened; fewer than `keep`, so opened ones stay. */
export const copiedAhead = 8;
const pause = 5_000;

const root = () => new Directory(Paths.cache, "relay-offline");
/** Each paired computer keeps its own copy; threads go to the one in use. */
let current = "";
const folder = (computer = current) => new Directory(root(), computer);
const overviewFile = (computer?: string) =>
  new File(folder(computer), "overview.json");
const threadFile = (id: string) => new File(folder(), `thread-${id}.json`);

/** Which computer's copy threads are read from and written to from now on. */
export function setOfflineComputer(computer: string) {
  current = computer;
}

async function read<T>(file: File): Promise<T | undefined> {
  try {
    return file.exists ? (JSON.parse(await file.text()) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(file: File, value: unknown) {
  try {
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    file.write(JSON.stringify(value));
  } catch {
    // A full disk costs the offline copy, nothing else.
  }
}

/** Writes at most once per pause per key; the latest value wins. */
const waiting = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; save: () => void }
>();
function later(key: string, save: () => void) {
  const held = waiting.get(key);
  if (held) {
    held.save = save;
    return;
  }
  const entry = {
    save,
    timer: setTimeout(() => {
      waiting.delete(key);
      entry.save();
    }, pause),
  };
  waiting.set(key, entry);
}

export const loadOverview = (computer: string) =>
  read<RemoteOverview>(overviewFile(computer));

// The file is picked now: a switch to another computer before the write
// mustn't land this one's copy in that one's folder.
export function saveOverview(computer: string, overview: RemoteOverview) {
  const file = overviewFile(computer);
  later(file.uri, () => write(file, overview));
}

/** The agents' model lists as last listed, so a composer names its model before the computer answers. */
const modelsFile = () => new File(folder(), "models.json");
export const loadModels = () => read<ModelCatalogs>(modelsFile());
export function saveModels(lists: ModelCatalogs) {
  const file = modelsFile();
  later(file.uri, () => write(file, lists));
}

/** What a new thread starts on, so its composer is there before the computer answers. */
type NewThread = { settings: RemoteSettings; models: NewThreadModels };
const newThreadFile = (computer?: string) => new File(folder(computer), "new-thread.json");
export const loadNewThread = (computer?: string) => read<NewThread>(newThreadFile(computer));
export function saveNewThread(start: NewThread, computer?: string) {
  const file = newThreadFile(computer);
  later(file.uri, () => write(file, start));
}

/**
 * The threads read or saved last, so one opened again is there on its first
 * frame, newer than a save still waiting out its pause. Few: a thread can
 * hold its pictures.
 */
const remembered = new Map<string, Thread>();
const rememberedCount = 8;
function remember(file: File, thread: Thread) {
  remembered.delete(file.uri);
  remembered.set(file.uri, thread);
  for (const uri of remembered.keys()) {
    if (remembered.size <= rememberedCount) break;
    remembered.delete(uri);
  }
}

export const loadThread = async (id: string) => {
  const file = threadFile(id);
  return remembered.get(file.uri) ?? read<Thread>(file);
};

/** The saved copy, read before the screen's first frame instead of a spinner's. */
export function threadNow(id: string): Thread | undefined {
  const file = threadFile(id);
  const held = remembered.get(file.uri);
  if (held) return held;
  try {
    if (!file.exists) return undefined;
    const thread = JSON.parse(file.textSync()) as Thread;
    remember(file, thread);
    return thread;
  } catch {
    return undefined;
  }
}

/** Whether the saved copy is missing or older than the thread's last change. */
export function threadStale(id: string, updated: number) {
  try {
    const file = threadFile(id);
    return !file.exists || (file.modificationTime ?? 0) < updated;
  } catch {
    return true;
  }
}

export function saveThread(id: string, thread: Thread) {
  const file = threadFile(id);
  remember(file, thread);
  later(file.uri, () => {
    write(file, thread);
    prune(file.parentDirectory);
  });
}

function prune(dir: Directory) {
  try {
    const threads = dir
      .list()
      .filter(
        (f): f is File => f instanceof File && f.name.startsWith("thread-"),
      )
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const old of threads.slice(keep)) old.delete();
  } catch {}
}

/** Unpairing leaves nothing of the computer behind on the phone. */
export function forgetOffline(computer: string) {
  const dir = folder(computer);
  for (const [key, { timer }] of waiting)
    if (key.startsWith(dir.uri)) {
      clearTimeout(timer);
      waiting.delete(key);
    }
  for (const uri of remembered.keys())
    if (uri.startsWith(dir.uri)) remembered.delete(uri);
  try {
    if (dir.exists) dir.delete();
  } catch {}
}

/** The single computer's copy from before there could be several, loose in the root. */
export function dropLooseCopy() {
  try {
    for (const item of root().list()) if (item instanceof File) item.delete();
  } catch {}
}
