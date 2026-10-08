import { useEffect, useState } from "react";
import type { SettingsCategory } from "../../lib/settings-page";

/**
 * Settings is a page over the workspace: going anywhere else, a ⌘1 jump
 * say, leaves it. `projectId`, `chatId` and `surface` are where the shell is.
 */
export function useSettingsPage(
  projectId: string | null,
  chatId: string | null,
  surface: string,
) {
  const [open, setOpen] = useState(false),
    [category, setCategory] = useState<SettingsCategory>(),
    [project, setProject] = useState<string>(),
    [query, setQuery] = useState(""),
    [where, setWhere] = useState("");
  useEffect(() => {
    setOpen(false);
    setCategory(undefined);
    setProject(undefined);
  }, [projectId, chatId, surface]);
  return {
    open,
    /** The category it opens at. */
    category,
    /** The project explicitly opened from a project entry point. */
    project,
    /** Search survives closing the page for the lifetime of this window. */
    query,
    setQuery,
    /** Where in Settings it is, for the window title. */
    where,
    setWhere,
    show(at?: SettingsCategory, projectId?: string) {
      setCategory(at);
      setProject(at === "project" ? projectId : undefined);
      setOpen(true);
    },
    close() {
      setOpen(false);
      setCategory(undefined);
      setProject(undefined);
    },
  };
}
