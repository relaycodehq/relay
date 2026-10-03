import { useEffect, useState } from "react";
import { readJson } from "../../lib/persisted-store";
import { parseSavedChanges, type SelectedChange } from "./working-changes";

/**
 * The selected diff, the commit message and the folder grouping, which a
 * project's local changes keep across restarts. A PR checkout's don't.
 */
export function useSavedChanges(projectId: string | undefined) {
  const key = projectId ? "relay-project-changes:" + projectId : null;
  const [saved] = useState(() => parseSavedChanges(key && readJson(key)));
  const [selected, setSelected] = useState<SelectedChange | null>(
      saved.selected,
    ),
    [message, setMessage] = useState(saved.message),
    [grouped, setGrouped] = useState(saved.grouped);
  useEffect(() => {
    if (key)
      localStorage.setItem(key, JSON.stringify({ selected, message, grouped }));
  }, [key, selected, message, grouped]);
  return { selected, setSelected, message, setMessage, grouped, setGrouped };
}
