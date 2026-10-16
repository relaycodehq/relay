import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeViewItem } from "@pierre/diffs";
import type { EditorViewState, Marker } from "@pierre/diffs/edit";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import type { LocalFile } from "../../../../shared/types";
import { useFileDiff } from "../../diff/useFileDiff";

type Handle = CodeViewHandle<undefined, undefined>;
export type FileEditor = NonNullable<ReturnType<Handle["getEditor"]>>;

/** Pierre ends an item's edit session by its id, so the file and its comparison each need their own. */
const itemId = (path: string, compare: boolean) =>
  compare ? `${path} · compare` : path;

/**
 * The open file as the code view's one editable item: the file by itself, or
 * with `compare`, beside its committed version. Keeps `markers` on its editor
 * and puts the caret on `line` the first time each item's editor attaches.
 *
 * A new item (a reload, or switching between the file and the comparison)
 * starts from the edits so far and keeps the caret and scroll the last one
 * had; a `quiet` one (read again because the disk changed) also leaves the
 * focus where it is.
 */
export function useEditorView({
  path,
  source,
  revision,
  buffer,
  compare,
  line,
  markers,
  quiet = false,
}: {
  path: string;
  source: LocalFile | undefined;
  revision: string;
  /** The edited text, which a new item starts from. */
  buffer: string | undefined;
  compare: boolean;
  line: number | undefined;
  markers: Marker[];
  quiet?: boolean;
}) {
  const latest = useRef(buffer);
  latest.current = buffer;
  const opened = useMemo(() => {
    if (!source) return undefined;
    const contents = latest.current ?? source.contents;
    return {
      source,
      compare,
      contents,
      // The worker's colours are cached by key, so edited text needs its own.
      cacheKey:
        contents === source.contents
          ? `local:${source.version}`
          : `local:${source.version}:${Date.now()}`,
    };
  }, [source, compare]);
  const compared = useFileDiff(
    useMemo(
      () =>
        opened?.compare
          ? {
              editable: true,
              old: {
                name: path,
                contents: opened.source.original,
                cacheKey: `${revision}:${path}`,
              },
              next: {
                name: path,
                contents: opened.contents,
                cacheKey: opened.cacheKey,
              },
              binary: false,
            }
          : undefined,
      [opened],
    ),
  );
  const diff = compared.diff;
  const ready = !!opened && (!opened.compare || !!diff);
  const viewer = useRef<Handle>(null);
  // Pierre colours an editable file on the main thread, all of it before any
  // of it shows: ~0.8 s for 500 lines of TypeScript. Read-only, the worker
  // pool shows it at once and colours it off the thread; the editor then
  // takes those colours over. A reload stays editable, so it keeps its caret.
  const id = itemId(path, compare);
  const [editableId, setEditableId] = useState<string>();
  const editable = editableId === id;
  const startEditing = () => setEditableId(id);
  useEffect(() => {
    if (!ready || editable) return;
    // A click starts it at once; this covers a worker that never answers.
    const fallback = setTimeout(() => setEditableId(id), 3000);
    // A line the editor's caret would bring into view.
    const scroll = requestAnimationFrame(() => {
      if (line)
        viewer.current?.scrollTo({
          type: "line",
          id,
          lineNumber: line,
          ...(compare ? { side: "additions" } : {}),
          align: "center",
        });
    });
    return () => {
      clearTimeout(fallback);
      cancelAnimationFrame(scroll);
    };
  }, [ready, editable, id, line, compare]);
  // Read while the old editor is still there, before the new item replaces it.
  const kept = useRef<{
    opened?: typeof opened;
    view?: EditorViewState;
    focused?: Element | null;
  }>({});
  if (kept.current.opened !== opened) {
    const previous = kept.current.opened;
    let view: EditorViewState | undefined;
    try {
      if (previous)
        view = viewer.current
          ?.getEditor(itemId(path, previous.compare))
          ?.getViewState();
    } catch {
      // Not attached yet: nothing to keep.
    }
    kept.current = { opened, view, focused: document.activeElement };
  }
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const focusedItem = useRef<typeof opened>(undefined);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (!opened) return [];
    const edit = {
      id: itemId(path, opened.compare),
      edit: editable,
      version: Date.now(),
    };
    if (!opened.compare)
      return [
        {
          ...edit,
          type: "file",
          file: {
            name: path,
            contents: opened.contents,
            cacheKey: opened.cacheKey,
          },
        },
      ];
    return diff ? [{ ...edit, type: "diff", fileDiff: diff }] : [];
  }, [opened, diff, editable]);
  useEffect(() => {
    try {
      viewer.current?.getEditor(id)?.setMarkers(markers);
    } catch (error) {
      // The editor exists before its document does; onAttach applies the
      // latest markers once it is there.
      if (!/Text document is not initialized/.test(String(error))) throw error;
    }
  }, [markers, id, items]);
  const editorOptions = useMemo<
    CodeViewProps<undefined, undefined>["editorOptions"]
  >(
    () => ({
      onAttach: (editor) => {
        editor.setMarkers(markersRef.current);
        if (focusedItem.current === opened) return;
        focusedItem.current = opened;
        const { view, focused } = kept.current;
        if (view) {
          try {
            editor.setViewState(view);
          } catch {
            // The new text may be too short for the old caret; start over.
          }
          // Focus left with the old editor only if it was in there.
          if (quietRef.current && focused?.isConnected !== false) return;
        }
        requestAnimationFrame(() => {
          if (live.current)
            editor.focus(
              view ? { preventScroll: true } : { lineNumber: line ?? 1 },
            );
        });
      },
    }),
    [opened, line],
  );
  return {
    viewer,
    ready,
    error: compared.error,
    items,
    editorOptions,
    editable,
    startEditing,
    /** Once the worker has coloured the read-only file, the editor takes over. */
    onPostRender: (_node: HTMLElement, rendered: unknown) => {
      if (!editable && coloured(rendered)) startEditing();
    },
    editor: (): FileEditor | undefined => viewer.current?.getEditor(id),
  };
}

/**
 * Whether Pierre's render of a file or diff carries the worker's colours.
 * Pierre doesn't say so publicly; should these fields go, the fallback timer
 * starts editing instead.
 */
function coloured(rendered: unknown) {
  const view = rendered as {
    hunksRenderer?: { renderCache?: { highlighted?: boolean } };
    fileRenderer?: { renderCache?: { highlighted?: boolean } };
  };
  const renderer = view.hunksRenderer ?? view.fileRenderer;
  return renderer?.renderCache?.highlighted === true;
}
