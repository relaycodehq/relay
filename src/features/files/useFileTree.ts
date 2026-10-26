import { useCallback, useMemo, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { DirListing } from "../../../shared/project-files";
import { api } from "../../lib/api";
import { visibleDirectories } from "../../lib/file-tree";
import { usePoll } from "../../lib/poll";
import { readJson, writeJson } from "../../lib/persisted-store";

export const directoryKey = (where: string, dir?: string) =>
  dir === undefined
    ? (["project-dir", where] as const)
    : (["project-dir", where, dir] as const);

const storageKey = (where: string) => "relay-project-tree:" + where;

/** Which folders are open in a workspace's tree, kept between sessions. */
export function useExpanded(where: string) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const value = readJson(storageKey(where));
    return new Set(
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [],
    );
  });
  const update = useCallback(
    (change: (set: Set<string>) => void) =>
      setExpanded((current) => {
        const next = new Set(current);
        change(next);
        if (
          next.size === current.size &&
          [...next].every((p) => current.has(p))
        )
          return current;
        writeJson(storageKey(where), [...next]);
        return next;
      }),
    [where],
  );
  return {
    expanded,
    toggle: (path: string) =>
      update((s) => void (s.delete(path) || s.add(path))),
    expand: (paths: string[]) => update((s) => paths.forEach((p) => s.add(p))),
    collapse: (path: string) => update((s) => void s.delete(path)),
    /** A folder moved or went to the Trash (`to` null): its open subfolders follow or go. */
    remap: (from: string, to: string | null) =>
      update((s) => {
        for (const path of [...s]) {
          if (path !== from && !path.startsWith(from + "/")) continue;
          s.delete(path);
          if (to !== null) s.add(to + path.slice(from.length));
        }
      }),
  };
}

/** The project's own tree, among the folders the sidebar shows. */
export const PROJECT_ROOT = "";

/**
 * Which folders' trees are open in a workspace's sidebar, kept between
 * sessions: the project's, open until folded, and linked folders', folded
 * until opened, as a linked repository can be large.
 */
export function useOpenRoots(where: string) {
  const key = "relay-project-roots:" + where;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const value = readJson(key);
    return new Set(
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [PROJECT_ROOT],
    );
  });
  return {
    isOpen: (root: string) => open.has(root),
    toggle: (root: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (!next.delete(root)) next.add(root);
        writeJson(key, [...next]);
        return next;
      }),
  };
}

/**
 * How often a shown folder is listed again. Watched, the shell refreshes it
 * when the folder changes, and the slow poll catches what the watch skips,
 * as a change only inside node_modules.
 */
export const listingPoll = (watched: boolean) => (watched ? 60_000 : 5000);

/** Only folders reachable in the tree poll; hidden descendants keep their expansion. */
export function useDirectories(
  where: string,
  open: ReadonlySet<string>,
  watched: boolean,
  active: boolean,
) {
  const poll = usePoll();
  const dirs = useMemo(() => visibleDirectories(open), [open]);
  const combine = useCallback(
    (results: UseQueryResult<DirListing>[]) => ({
      listings: Object.fromEntries(
        dirs.map((dir, i) => [dir, results[i]?.data]),
      ),
      error: results[0]?.error,
    }),
    [dirs],
  );
  return useQueries({
    queries: dirs.map((dir) => ({
      queryKey: directoryKey(where, dir),
      queryFn: () => api.projectDirectory(where, dir),
      enabled: active,
      staleTime: 0,
      refetchInterval: poll(listingPoll(watched)),
      retry: false,
    })),
    combine,
  });
}
