import { useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { useShortcut } from "../../lib/shortcuts";
import type { PanelTabs } from "./panel-tabs";

/**
 * The new-tab key, pressed in the panel or inside one of its pages, shows
 * the picker; in a terminal it is the terminal's, for another shell.
 */
export function useNewTabKey(
  panel: PanelTabs,
  pageKey: (page?: string) => string,
) {
  const ours = (key: string) =>
    panel.tabs.some((t) => t.surface === "browser" && pageKey(t.page) === key);
  const pick = () => {
    // A field keeps the keyboard otherwise, and the picker's letters with it.
    (document.activeElement as HTMLElement | null)?.blur();
    panel.pick();
  };
  useShortcut("new-terminal", true, pick, {
    meant: (e) => {
      const target = e.target as Element | null;
      return (
        !!target?.closest?.('[data-pane="panel"]') &&
        !target.closest(".terminal-view")
      );
    },
  });
  const latest = useRef({ ours, pick });
  latest.current = { ours, pick };
  useEffect(
    () =>
      api.onPreviewNewTab(({ key }) => {
        if (latest.current.ours(key)) latest.current.pick();
      }),
    [],
  );
}
