import { useEffect, useRef, useState } from "react";
import type { NavigationLock } from "../lib/navigation-lock";
import { onOpenSchedule } from "../lib/open-schedule";
import type { ShellNavigation, Surface } from "./useShellNavigation";

/** The pages the sidebar's tools open in place of a project. */
type ToolPage = "usage" | "schedules";
const isToolPage = (surface: Surface): surface is ToolPage =>
  surface === "usage" || surface === "schedules";

/**
 * Usage and Schedules: each opens in place of a project and
 * closes back to the page it was opened from.
 */
export function useToolPages(nav: ShellNavigation, lock: NavigationLock) {
  const pageFrom = useRef<Surface>("project");
  /** Opens a tool page, or closes it when it's open already, unless `keepOpen`. */
  function togglePage(page: ToolPage, keepOpen = false) {
    if (lock.blocked()) return;
    if (nav.surface === page) {
      if (!keepOpen) nav.setSurface(pageFrom.current);
      return;
    }
    // Hopping between tool pages still leads back to where the first one opened from.
    if (!isToolPage(nav.surface)) pageFrom.current = nav.surface;
    nav.setSurface(page);
  }
  // A scheduled run's message leads to its schedule.
  const [scheduleShown, setScheduleShown] = useState<string>();
  useEffect(() =>
    onOpenSchedule((id) => {
      setScheduleShown(id);
      togglePage("schedules", true);
    }),
  );
  return {
    toggleUsage: () => togglePage("usage"),
    toggleSchedules: () => togglePage("schedules"),
    scheduleShown,
  };
}
