import { useState } from "react";
import { useStoredState } from "./persisted-store";

const asObject = (saved: unknown) =>
  (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;

/** A group's key among the projects' in what's open. */
export const groupKey = (path: string) => "folder:" + path;

export type SidebarFolds = ReturnType<typeof useSidebarFolds>;

/**
 * What of the Projects view is open: its sections, groups and projects, kept
 * per device, and the lists showing all their threads, for this session.
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
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  return {
    /** A project's or group's list is open; `fallback` until it's toggled here. */
    isOpen: (key: string, fallback: boolean) => expanded[key] ?? fallback,
    setOpen: (key: string, open: boolean) =>
      setExpanded((state) => ({ ...state, [key]: open })),
    folded,
    fold: (section: keyof typeof folded) =>
      setFolded((s) => ({ ...s, [section]: !s[section] })),
    /** A project's, or the Scratchpad's, list shows past its first few threads. */
    showsAll: (key: string) => showAll[key],
    setShowsAll: (key: string, all: boolean) =>
      setShowAll((s) => ({ ...s, [key]: all })),
  };
}
