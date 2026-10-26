import { useCallback, useEffect, useState } from "react";
import { filePathSchema } from "../../../shared/validation";
import { readText, writeText } from "../../lib/persisted-store";
import { parseLayout, singleGroup, type EditorLayout } from "./editor-groups";
import { tabId } from "./editor-tabs";

const storageKey = (where: string) => "relay-editor-tabs:" + where;

/** The splits and tabs last saved for the workspace. */
export function loadLayout(where: string): EditorLayout {
  const saved = parseLayout(readText(storageKey(where)));
  if (saved) return saved;
  // Before tabs, the pane remembered the one file it had open.
  const path = filePathSchema.safeParse(
    readText("relay-project-file:" + where),
  ).data;
  if (!path) return singleGroup();
  const tab = { path };
  return singleGroup({ tabs: [tab], active: tabId(tab), recent: [tabId(tab)] });
}

/** The workspace's editor splits and their tabs, kept across restarts. */
export function useEditorLayout(where: string) {
  const [state, setState] = useState(() => ({
    where,
    layout: loadLayout(where),
  }));
  const layout = state.where === where ? state.layout : loadLayout(where);
  useEffect(() => {
    if (state.where !== where) setState({ where, layout: loadLayout(where) });
  }, [where]);
  useEffect(() => {
    if (state.where === where)
      writeText(storageKey(where), JSON.stringify(state.layout));
  }, [state, where]);
  const update = useCallback(
    (change: (layout: EditorLayout) => EditorLayout) =>
      setState((current) =>
        current.where === where
          ? { where, layout: change(current.layout) }
          : { where, layout: change(loadLayout(where)) },
      ),
    [where],
  );
  return [layout, update] as const;
}
