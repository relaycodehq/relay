import { useEffect, useMemo, useRef } from "react";
import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";
import type { Marker } from "@pierre/diffs/edit";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import type { LocalFile } from "../../shared/types";
import { useFileDiff } from "./useFileDiff";

type Handle = CodeViewHandle<undefined, undefined>;
export type FileEditor = NonNullable<ReturnType<Handle["getEditor"]>>;

/**
 * The loaded file against its committed version, as the code view's one
 * editable item. Keeps `markers` on its editor and puts the caret on `line`
 * the first time each diff's editor attaches.
 */
export function useEditableDiff(
  path: string,
  source: LocalFile | undefined,
  revision: string,
  line: number | undefined,
  markers: Marker[],
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
    viewer.current?.getEditor(path)?.setMarkers(markers);
  }, [markers, path, diff]);
  const editorOptions = useMemo<
    CodeViewProps<undefined, undefined>["editorOptions"]
  >(
    () => ({
      onAttach: (editor) => {
        editor.setMarkers(markersRef.current);
        if (focusedDiff.current === diff) return;
        focusedDiff.current = diff;
        requestAnimationFrame(() => {
          if (live.current) editor.focus({ lineNumber: line ?? 1 });
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
