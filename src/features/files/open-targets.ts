import type { OpenTarget as EditorOpenTarget } from "../editor/FileEditor";
import type { OpenTarget as SearchOpenTarget } from "../project-search";
import type { EditorTab } from "./editor-tabs";
import type { OpenAt } from "./useTabOpening";

/** Where a symbol lookup or link leads: a tab to open, and the caret in it (columns from 1). */
export function editorJump(target: EditorOpenTarget): [EditorTab, OpenAt] {
  const tab = target.outside
    ? { path: target.path, outside: true }
    : { path: target.path };
  return [tab, { line: target.line, column: target.column }];
}

/** Where a search result leads. Its columns count from 0, the editor's from 1. */
export function searchJump(target: SearchOpenTarget): [EditorTab, OpenAt] {
  const column = target.column === undefined ? undefined : target.column + 1;
  return [{ path: target.path }, { line: target.line, column }];
}
