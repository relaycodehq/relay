import { splitOutsidePath } from "../../../shared/project-file-links";
import { api } from "../../lib/api";
import type { EditorTab } from "./editor-tabs";

/** The full path on this computer, which a tab outside the project already has. */
export async function copyFullPath(tab: EditorTab, where: string) {
  const full = tab.outside
    ? tab.path
    : await api.projectAbsolutePath(where, tab.path);
  await api.writeClipboard(full);
}

/** The path from the project folder; only project files have one. */
export const copyRelativePath = (tab: EditorTab) =>
  api.writeClipboard(tab.path);

/** Selects the file in the system's file manager. */
export function showInFileManager(tab: EditorTab, where: string) {
  if (!tab.outside) return api.revealProjectPath(where, tab.path);
  const { folder, name } = splitOutsidePath(tab.path);
  return api.revealProjectPath(folder, name);
}
