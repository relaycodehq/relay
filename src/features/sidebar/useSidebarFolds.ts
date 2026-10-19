import { useState } from "react";
import { useStoredState } from "../../lib/persisted-store";

const asObject = (saved: unknown) =>
  (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;

/** A group's key among the projects' in what's open. */
export const groupKey = (path: string) => "folder:" + path;

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
