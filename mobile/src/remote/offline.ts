// What the phone last saw of the computer, so the lists and recent threads
// can still be read on a train. Written a little behind the live state and
// replaced by it as soon as the computer answers again.
import { Directory, File, Paths } from "expo-file-system";
import type { RemoteOverview } from "../../../shared/remote";
import type { Thread } from "./chat-state";

/** Threads kept for reading offline, most recently opened first. */
const keep = 20;
const pause = 5_000;

const folder = () => new Directory(Paths.cache, "relay-offline");
const overviewFile = () => new File(folder(), "overview.json");
const threadFile = (id: string) => new File(folder(), `thread-${id}.json`);

async function read<T>(file: File): Promise<T | undefined> {
  try {
    return file.exists ? (JSON.parse(await file.text()) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(file: File, value: unknown) {
  try {
    folder().create({ idempotent: true, intermediates: true });
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

export const loadOverview = () => read<RemoteOverview>(overviewFile());

export function saveOverview(overview: RemoteOverview) {
  later("overview", () => write(overviewFile(), overview));
}

export const loadThread = (id: string) => read<Thread>(threadFile(id));

export function saveThread(id: string, thread: Thread) {
  later(`thread-${id}`, () => {
    write(threadFile(id), thread);
    prune();
  });
}

function prune() {
  try {
    const threads = folder()
      .list()
      .filter(
        (f): f is File => f instanceof File && f.name.startsWith("thread-"),
      )
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const old of threads.slice(keep)) old.delete();
  } catch {}
}

/** Unpairing leaves nothing of the computer behind on the phone. */
export function forgetOffline() {
  for (const { timer } of waiting.values()) clearTimeout(timer);
  waiting.clear();
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch {}
}
