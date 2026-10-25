import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Bootstrap, SidebarView } from "../../../shared/types";
import { api } from "../../lib/api";
import { useShortcut } from "../../lib/shortcuts";
import { readText, writeText } from "../../lib/persisted-store";

/** Activity or Projects, kept in app data; the `activity` shortcut flips it. */
export function useSidebarView(initialView?: SidebarView) {
  const qc = useQueryClient();
  const [view, setView] = useState<SidebarView>(() => {
    if (initialView) return initialView;
    // Preserve the selection from versions that only used browser storage.
    return readText("relay-sidebar-view") === "activity"
      ? "activity"
      : "threads";
  });
  const { mutate: saveView, error } = useMutation({
    mutationFn: (next: SidebarView) => api.saveSidebarView(next),
    onSuccess: (_, sidebarView) => {
      qc.setQueryData<Bootstrap>(["bootstrap"], (boot) =>
        boot ? { ...boot, sidebarView } : boot,
      );
      writeText("relay-sidebar-view", null);
    },
  });
  useEffect(() => saveView(view), [view, saveView]);
  const toggle = () =>
    setView((v) => (v === "activity" ? "threads" : "activity"));
  useShortcut("activity", true, toggle);
  return { view, toggle, error };
}
