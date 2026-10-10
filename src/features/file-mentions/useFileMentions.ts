import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { foldersOf } from "./file-match";
import {
  changesByPath,
  fileTree,
  listItems,
  mentionTrigger,
  type MentionItem,
} from "./mention-items";
import { noteUsed } from "../../lib/used";

export interface MentionRange {
  start: number;
  end: number;
}

export function useFileMentions({
  draft,
  where,
  disabled,
  onPick,
  onFill,
}: {
  draft: string;
  /** The project or thread folder whose files are offered. */
  where: string;
  disabled: boolean;
  onPick: (path: string, range: MentionRange) => void;
  onFill: (range: MentionRange & { text: string }) => void;
}) {
  const id = useId();
  const [cursor, setCursor] = useState<number>();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const at = Math.min(cursor ?? draft.length, draft.length);
  const trigger = mentionTrigger(draft, at);
  const open = !!trigger && dismissed !== draft && !disabled;
  const files = useQuery({
    queryKey: ["project-files", where],
    queryFn: () => api.projectFiles(where),
    enabled: open,
    staleTime: 10_000,
  });
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: open,
    staleTime: 5_000,
    retry: false,
  });
  const index = useMemo(() => {
    const list = files.data ?? [];
    const changes = changesByPath(tree.data?.changes);
    return {
      files: list,
      folders: foldersOf(list),
      changes,
      tree: fileTree(list, new Set(changes.keys())),
    };
  }, [files.data, tree.data]);
  // Ranking a large checkout takes a frame or more; typing doesn't wait on it.
  const query = useDeferredValue(trigger?.query ?? "");
  const items: MentionItem[] = useMemo(
    () =>
      open
        ? listItems(
            query,
            index.files,
            index.folders,
            index.tree,
            index.changes,
          )
        : [],
    [open, query, index],
  );
  const visible = open && (files.isPending || items.length > 0 || !!query);
  useEffect(() => setActive(0), [query]);
  const selected = items[Math.min(active, items.length - 1)];

  /** Puts `@folder/` in place of what was typed, to look inside it. */
  function enter(dir: string) {
    if (!trigger) return;
    onFill({ start: trigger.start, end: at, text: "@" + dir });
  }
  function choose(item = selected) {
    if (!item || !trigger) return;
    noteUsed("mention");
    onPick(item.path, { start: trigger.start, end: at });
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!visible || e.nativeEvent.isComposing || e.keyCode === 229)
      return false;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    if (e.key === "Escape") {
      setDismissed(draft);
      return handled();
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length) {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + items.length) % items.length);
      return handled();
    }
    // Tab or → finishes a folder's name to look inside it, as a shell does.
    if ((e.key === "Tab" || e.key === "ArrowRight") && selected?.dir) {
      enter(selected.path);
      return handled();
    }
    if ((e.key === "Enter" || e.key === "Tab") && selected) {
      choose();
      return handled();
    }
    // ← backs out of a folder while nothing follows its slash.
    if (e.key === "ArrowLeft" && trigger?.query.endsWith("/")) {
      enter(trigger.query.replace(/[^/]*\/$/, ""));
      return handled();
    }
    return false;
  }
  return {
    id,
    visible,
    items,
    selected,
    active: Math.min(active, items.length - 1),
    setActive,
    query: trigger?.query ?? "",
    loading: files.isPending,
    error: files.error,
    total: index.files.length,
    tree: index.tree,
    where,
    choose,
    enter,
    setCursor,
    onKeyDown,
    dismiss: () => setDismissed(draft),
    activeId: selected
      ? `${id}-${Math.min(active, items.length - 1)}`
      : undefined,
  };
}

export type FileMentions = ReturnType<typeof useFileMentions>;
