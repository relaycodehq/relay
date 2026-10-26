import { useRef, useState } from "react";
import { ancestors } from "../../lib/file-tree";
import { useRequests, type RequestChannel } from "../../lib/request-channel";
import { useStoredFlag } from "../../lib/useStoredFlag";
import type { FilesRequest, SideView } from "./file-link-target";
import type { useExpanded } from "./useFileTree";
import type { EditorWorkspace } from "./useEditorWorkspace";

/** How the sidebar is being used: the folder picked, the name typed to find files, what it shows and whether it shows. */
export type FileBrowsing = ReturnType<typeof useFileBrowsing>;

/**
 * The sidebar's state, and the files, folders, versions, searches and views
 * other parts of the app ask it to show (a link clicked in the chat, a change).
 */
export function useFileBrowsing({
  opens,
  expansion,
  open,
}: {
  opens?: RequestChannel<FilesRequest>;
  expansion: ReturnType<typeof useExpanded>;
  open: EditorWorkspace["open"];
}) {
  // A folder picked in the tree; files open as tabs.
  const [folder, setFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [listHidden, setListHidden] = useStoredFlag("relay-file-list-hidden");
  const filterInput = useRef<HTMLInputElement>(null);

  const [changesInFront, setChangesInFront] = useStoredFlag("relay-editor-side-changes");
  // The worktree's view is for when it's asked for; a restart starts back on the files or changes.
  const [branchInFront, setBranchInFront] = useState(false);
  const sideView: SideView = branchInFront ? "branch" : changesInFront ? "changes" : "files";
  const showSideView = (view: SideView) => {
    setBranchInFront(view === "branch");
    if (view !== "branch") setChangesInFront(view === "changes");
    setListHidden(false);
  };
  const showFolder = (path: string) => {
    expansion.expand([...ancestors(path), path]);
    setFolder(path);
    showSideView("files");
  };
  const show = (target: FilesRequest) => {
    if ("view" in target) return showSideView(target.view);
    if ("snapshot" in target) return open({ path: target.path, snapshot: target.snapshot });
    const at = { line: target.line, changes: target.changes, baseline: target.baseline };
    if (target.outside) return open({ path: target.path, outside: true }, at);
    if (target.search !== undefined) {
      setFilter(target.search);
      return showSideView("files");
    }
    setFilter("");
    if (target.directory) showFolder(target.path);
    else open({ path: target.path }, at);
  };
  useRequests(opens, show);

  return {
    folder,
    setFolder,
    filter,
    setFilter,
    listHidden,
    sideView,
    showSideView,
    /** Opens or shows what `target` asks, as a request from elsewhere in the app would. */
    show,
    toggleList: () => setListHidden((hidden) => !hidden),
    showFolder,
    filterInput,
    /** Shows the list with `path` in it, unfiltered, and scrolls to the file. */
    revealInList: (path: string) => {
      expansion.expand(ancestors(path));
      setFilter("");
      showSideView("files");
      scrollToRow(filterInput.current, path);
    },
    /** Shows the list and puts the caret in its find box. */
    focusFilter: () => {
      setListHidden(false);
      requestAnimationFrame(() => filterInput.current?.focus());
    },
  };
}

/**
 * Scrolls the list row of `path` into view. The row appears once the list
 * has shown and its folders have loaded, so this looks again for a moment.
 */
function scrollToRow(inList: HTMLElement | null, path: string, tries = 20) {
  const list = inList?.closest(".project-file-list");
  if (!list || tries === 0) return;
  requestAnimationFrame(() => {
    const row = list.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
    else scrollToRow(inList, path, tries - 1);
  });
}
