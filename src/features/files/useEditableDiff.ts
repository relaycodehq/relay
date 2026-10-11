import { useEffect, useMemo, useRef } from "react";
import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";
import type { EditorViewState, Marker } from "@pierre/diffs/edit";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import type { LocalFile } from "../../../shared/types";
import { useFileDiff } from "../diff/useFileDiff";

type Handle = CodeViewHandle<undefined, undefined>;
export type FileEditor = NonNullable<ReturnType<Handle["getEditor"]>>;

/**
 * The loaded file against its committed version, as the code view's one
 * editable item. Keeps `markers` on its editor and puts the caret on `line`
 * the first time each diff's editor attaches. A reloaded file keeps the caret
 * and scroll it had; a `quiet` one (read again because the disk changed)
 * also leaves the focus where it is.
 */
export function useEditableDiff(
  path: string,
  source: LocalFile | undefined,
  revision: string,
  line: number | undefined,
  markers: Marker[],
  quiet = false,
) {
  const compared = useFileDiff(
    useMemo(
      () =>
        source && {
          editable: true,
          old: {
            name: path,
            contents: source.original,
            cacheKey: `${revision}:${path}`,
          },
          next: {
            name: path,
            contents: source.contents,
            cacheKey: `local:${source.version}`,
          },
          binary: false,
        },
      [source],
    ),
  );
  const diff = compared.diff;
  const viewer = useRef<Handle>(null);
  // Read while the old editor is still there, before the new text replaces it.
  const kept = useRef<{
    source?: LocalFile;
    view?: EditorViewState;
    focused?: Element | null;
  }>({});
  if (kept.current.source !== source) {
    let view: EditorViewState | undefined;
    try {
      view = viewer.current?.getEditor(path)?.getViewState();
    } catch {
      // Not attached yet: nothing to keep.
    }
    kept.current = { source, view, focused: document.activeElement };
  }
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const focusedDiff = useRef<FileDiffMetadata | undefined>(undefined);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      viewer.current?.getEditor(path)?.setMarkers(markers);
    } catch (error) {
      // The editor exists before its document does; onAttach applies the
      // latest markers once it is there.
      if (!/Text document is not initialized/.test(String(error))) throw error;
    }
  }, [markers, path, diff]);
  const editorOptions = useMemo<
    CodeViewProps<undefined, undefined>["editorOptions"]
  >(
    () => ({
      onAttach: (editor) => {
        editor.setMarkers(markersRef.current);
        if (focusedDiff.current === diff) return;
        focusedDiff.current = diff;
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
    [diff, line],
  );
  const items = useMemo<CodeViewDiffItem[]>(
    () =>
      diff
        ? [
            {
              id: path,
              type: "diff",
              fileDiff: diff,
              edit: true,
              version: Date.now(),
            },
          ]
        : [],
    [diff],
  );
  return {
    viewer,
    diff,
    error: compared.error,
    items,
    editorOptions,
    editor: (): FileEditor | undefined => viewer.current?.getEditor(path),
  };
}
