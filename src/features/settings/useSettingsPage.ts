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
    [where, setWhere] = useState("");
  useEffect(() => {
    setOpen(false);
    setCategory(undefined);
  }, [projectId, chatId, surface]);
  return {
    open,
    /** Opens or leaves the page, keeping the category it was last opened at. */
    setOpen,
    /** The category it opens at. */
    category,
    /** The project its Projects category opens on, when one was asked for. */
    project,
    /** Where in Settings it is, for the window title. */
    where,
    setWhere,
    show(at?: SettingsCategory, projectId?: string) {
      setCategory(at);
      setProject(projectId);
      setOpen(true);
    },
    close() {
      setOpen(false);
      setCategory(undefined);
    },
  };
}
