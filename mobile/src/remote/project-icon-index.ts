// The phone's index of project icons, kept apart per computer: each sync
// answers for one computer's projects, so it may only replace or drop that
// computer's icons.
import type { RemoteProjectIcon } from "../../../shared/remote";

export type IconEntry = { hash: string | null; uri?: string };
/** Icons by computer, then by project id. */
export type IconIndex = Record<string, Record<string, IconEntry>>;

/** The hashes the phone holds for these projects of `computer`, to ask only for the rest. */
export function knownHashes(
  index: IconIndex,
  computer: string,
  projectIds: string[],
) {
  const mine = index[computer] ?? {};
  return Object.fromEntries(
    projectIds.filter((id) => id in mine).map((id) => [id, mine[id]!.hash]),
  );
}

/**
 * The index once `computer` answered with `updates` for `projectIds`: changed
 * icons replaced, its removed projects' icons gone, other computers' left as
 * they were. `unused` are the files nothing points at any more.
 */
export function applyIconUpdates(
  index: IconIndex,
  computer: string,
  projectIds: string[],
  updates: Record<string, RemoteProjectIcon>,
  save: (id: string, icon: { hash: string; dataUrl: string }) => string | undefined,
): { index: IconIndex; unused: string[] } {
  const mine = { ...index[computer] };
  const unused: string[] = [];
  for (const [id, icon] of Object.entries(updates)) {
    const old = mine[id]?.uri;
    mine[id] = icon.hash ? { hash: icon.hash, uri: save(id, icon) } : { hash: null };
    if (old && old !== mine[id].uri) unused.push(old);
  }
  for (const id of Object.keys(mine))
    if (!projectIds.includes(id)) {
      if (mine[id]!.uri) unused.push(mine[id]!.uri!);
      delete mine[id];
    }
  return { index: { ...index, [computer]: mine }, unused };
}

/** Every computer's icons by project id; ids are random, so they don't meet. */
export function iconsByProject(index: IconIndex) {
  const all: Record<string, IconEntry> = {};
  for (const icons of Object.values(index)) Object.assign(all, icons);
  return all;
}
