import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Bootstrap, SidebarView } from "../../../shared/types";
import { api } from "../../lib/api";
import { useShortcut } from "../../lib/shortcuts";

/** Activity or Projects, kept in app data; the `activity` shortcut flips it. */
export function useSidebarView(initialView?: SidebarView) {
  const qc = useQueryClient();
  const [view, setView] = useState<SidebarView>(() => {
    if (initialView) return initialView;
    // Preserve the selection from versions that only used browser storage.
    try {
      if (localStorage.getItem("relay-sidebar-view") === "activity")
        return "activity";
    } catch {
      // App data remains usable when browser storage isn't.
    }
    return "threads";
  });
  const { mutate: saveView, error } = useMutation({
    mutationFn: (next: SidebarView) => api.saveSidebarView(next),
    onSuccess: (_, sidebarView) => {
      qc.setQueryData<Bootstrap>(["bootstrap"], (boot) =>
        boot ? { ...boot, sidebarView } : boot,
      );
      try {
        localStorage.removeItem("relay-sidebar-view");
      } catch {
        // The choice has already been saved in app data.
      }
    },
  });
  useEffect(() => saveView(view), [view, saveView]);
  const toggle = () =>
    setView((v) => (v === "activity" ? "threads" : "activity"));
  useShortcut("activity", true, toggle);
  return { view, toggle, error };
}
