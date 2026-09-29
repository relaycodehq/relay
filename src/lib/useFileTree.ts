import { useCallback, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { DirListing } from "../../shared/project-files";
import { api } from "./api";

export const directoryKey = (where: string, dir?: string) =>
  dir === undefined
    ? (["project-dir", where] as const)
    : (["project-dir", where, dir] as const);

const storageKey = (where: string) => "relay-project-tree:" + where;

/** Which folders are open in a workspace's tree, kept between sessions. */
export function useExpanded(where: string) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey(where)) ?? "[]",
      );
      return new Set(
        Array.isArray(value)
          ? value.filter((v): v is string => typeof v === "string")
          : [],
      );
    } catch {
      return new Set();
    }
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
        localStorage.setItem(storageKey(where), JSON.stringify([...next]));
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

/** The root and every open folder, listed from disk and refreshed while shown. */
export function useDirectories(where: string, open: ReadonlySet<string>) {
  const dirs = ["", ...open];
  return useQueries({
    queries: dirs.map((dir) => ({
      queryKey: directoryKey(where, dir),
      queryFn: () => api.projectDirectory(where, dir),
      refetchInterval: 5000,
      retry: false,
    })),
    combine: (results) => ({
      listing: (dir: string): DirListing | undefined =>
        results[dirs.indexOf(dir)]?.data,
      error: results[0]?.error,
    }),
  });
}
