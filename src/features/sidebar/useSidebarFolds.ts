import { useState } from "react";
import { rebaseGroup } from "../../../shared/project-folders";
import { useStoredState } from "../../lib/persisted-store";

const asObject = (saved: unknown) =>
  (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;

const FOLDER = "folder:";

/** A group's key among the projects' in what's open. */
export const groupKey = (path: string) => FOLDER + path;

/**
 * `expanded` with the groups inside group `from` moved under `to`, as
 * renaming it or taking it apart moves them; `from` itself stays as it was.
 */
export function regroupedFolds(
  expanded: Record<string, boolean>,
  from: string,
  to: string,
): Record<string, boolean> {
  const inside = (key: string) => key.startsWith(groupKey(from + "/"));
  const kept = Object.entries(expanded).filter(([key]) => !inside(key));
  const moved = Object.entries(expanded)
    .filter(([key]) => inside(key))
    .map(([key, open]) => {
      const path = rebaseGroup(key.slice(FOLDER.length), from, to);
      return [groupKey(path), open] as const;
    });
  return Object.fromEntries([...kept, ...moved]);
}

export type SidebarFolds = ReturnType<typeof useSidebarFolds>;

/**
 * What of the Projects view is open: its sections, groups and projects, kept
 * per device, and how many pages of threads each list shows, for this session.
 */
export function useSidebarFolds() {
  const [expanded, setExpanded] = useStoredState(
    "relay-project-expansion",
    (saved) =>
      Object.fromEntries(
        Object.entries(asObject(saved))
          .filter(([, value]) => typeof value === "boolean")
          .map(([key, value]) => [key, value === true]),
      ) as Record<string, boolean>,
  );
  const [folded, setFolded] = useStoredState(
    "relay-sidebar-folded",
    (saved) => ({
      scratchpad: asObject(saved).scratchpad === true,
      projects: asObject(saved).projects === true,
    }),
  );
  const [pages, setPages] = useState<Record<string, number>>({});
  const firstPage = (key: string) =>
    setPages((s) => {
      const { [key]: _, ...rest } = s;
      return rest;
    });
  return {
    /** A project's or group's list is open; `fallback` until it's toggled here. */
    isOpen: (key: string, fallback: boolean) => expanded[key] ?? fallback,
    /** Opening or closing one starts its list over at its first page. */
    setOpen: (key: string, open: boolean) => {
      setExpanded((state) => ({ ...state, [key]: open }));
      firstPage(key);
    },
    /** Keeps what's open of the groups in `from` once they move under `to`. */
    regroup: (from: string, to: string) =>
      setExpanded((state) => regroupedFolds(state, from, to)),
    folded,
    fold: (section: keyof typeof folded) => {
      setFolded((s) => ({ ...s, [section]: !s[section] }));
      if (section === "scratchpad") firstPage("scratchpad");
    },
    /** How many pages of a project's, or the Scratchpad's, threads show. */
    pages: (key: string) => pages[key] ?? 1,
    showMore: (key: string) =>
      setPages((s) => ({ ...s, [key]: (s[key] ?? 1) + 1 })),
    showLess: firstPage,
  };
}
