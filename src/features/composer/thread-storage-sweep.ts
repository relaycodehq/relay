import {
  draftImageKeys,
  readDraftImageCounts,
  saveDraftImages,
} from "../images/draft-images";
import {
  currentNewThread,
  dropThreadDraft,
  hasDraft,
  newThreadId,
  newThreadProject,
} from "./drafts";
import {
  keyOwner,
  localOnlyRecord,
  migrateDrafts,
} from "../../lib/thread-storage";
import { RECORD_PREFIX } from "../../lib/thread-draft";

interface KnownThreads {
  projects: Set<string>;
  /** Archived threads included: a PR's thread or a saved place can reopen one. */
  threads: Set<string>;
}

/**
 * Whether anything can still open what's kept for `thread`: a thread while it
 * exists; an unsent one while its project does and it's the project's base,
 * holds text (Activity lists it) or is the one the project shows.
 */
function reachable(thread: string, known: KnownThreads): boolean {
  // A schedule's prompt goes when the schedule does.
  if (localOnlyRecord(thread)) return true;
  if (!thread.startsWith("new:")) return known.threads.has(thread);
  const project = newThreadProject(thread);
  // Not a shape Relay writes; not ours to judge.
  if (!project) return true;
  return (
    known.projects.has(project) &&
    (thread === newThreadId(project) ||
      hasDraft(thread) ||
      currentNewThread(project) === thread)
  );
}

/** Of `keys`, the per-thread and per-project ones nothing can reach. */
function staleKeys(keys: string[], known: KnownThreads): string[] {
  return keys.filter((key) => {
    const owner = keyOwner(key);
    if (!owner) return false;
    return "project" in owner
      ? !known.projects.has(owner.project)
      : !reachable(owner.thread, known);
  });
}

function storageKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

interface ThreadSource {
  projects(): Promise<{ id: string }[]>;
  /** Removed projects are only hidden: adding one again brings back its threads, drafts and all. */
  removedProjects(): Promise<string[]>;
  projectChats(projectId: string): Promise<{ id: string }[]>;
}

let swept = false;
/**
 * Once a launch, drops what's kept for threads and projects that are gone and
 * for unsent slots left empty, screenshots included. Nothing is dropped
 * unless every project's threads were read. Gives every thread there is, for
 * other stores to sweep by, or undefined once this launch has swept.
 */
export async function sweepThreadStorage(
  source: ThreadSource,
): Promise<Set<string> | undefined> {
  if (swept) return;
  swept = true;
  // Drafts kept the old way become records first, so the list below has them.
  migrateDrafts();
  // Listed before the threads are asked for: a thread exists before anything
  // is kept for it, so every key listed here belongs to a thread the answer has.
  const keys = storageKeys();
  const images = await draftImageKeys().catch(() => []);
  // An unsent slot holding only a screenshot is a draft too.
  await readDraftImageCounts();
  const [shown, removed] = await Promise.all([
    source.projects(),
    source.removedProjects(),
  ]);
  const projects = [...shown.map((p) => p.id), ...removed];
  const lists = await Promise.all(projects.map((id) => source.projectChats(id)));
  const known: KnownThreads = {
    projects: new Set(projects),
    threads: new Set(lists.flat().map((c) => c.id)),
  };
  for (const key of staleKeys(keys, known))
    if (key.startsWith(RECORD_PREFIX))
      dropThreadDraft(key.slice(RECORD_PREFIX.length));
    else localStorage.removeItem(key);
  for (const key of staleKeys(images, known)) await saveDraftImages(key, []);
  return known.threads;
}
