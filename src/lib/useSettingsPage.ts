import { useEffect, useState } from "react";
import type { SettingsCategory } from "./settings-page";

/**
 * Settings is a page over the workspace: going anywhere else, a ⌘1 jump
 * say, leaves it. `projectId`, `chatId` and `inbox` are where the shell is.
 */
export function useSettingsPage(
  projectId: string | null,
  chatId: string | null,
  inbox: boolean,
) {
  const [open, setOpen] = useState(false),
    [category, setCategory] = useState<SettingsCategory>(),
    [where, setWhere] = useState("");
  useEffect(() => {
    setOpen(false);
    setCategory(undefined);
  }, [projectId, chatId, inbox]);
  return {
    open,
    /** Opens or leaves the page, keeping the category it was last opened at. */
    setOpen,
    /** The category it opens at. */
    category,
    /** Where in Settings it is, for the window title. */
    where,
    setWhere,
    show(at?: SettingsCategory) {
      setCategory(at);
      setOpen(true);
    },
    close() {
      setOpen(false);
      setCategory(undefined);
    },
  };
}
