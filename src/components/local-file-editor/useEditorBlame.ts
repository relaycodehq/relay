import type { Pull } from "../../../shared/types";
import { useLineBlame } from "../LineBlame";

/**
 * Blame for the committed side, and for the local side while it still reads
 * as committed; once edited, its lines point at the committed side instead.
 */
export function useEditorBlame(
  target: Pull | { projectId: string; head: { sha: string } },
  path: string,
  revision: string,
  /** What the committed side is: the project's HEAD or the PR's head. */
  base: "HEAD" | "PR head",
  edited: boolean,
  plain: boolean,
  layout: "split" | "unified",
) {
  return useLineBlame(
    target,
    plain
      ? { deletions: undefined, additions: undefined }
      : {
          deletions: { revision, path, label: base },
          additions: {
            revision,
            path,
            label: "Local checkout",
            ...(edited
              ? {
                  unavailable:
                    base === "PR head"
                      ? "This local version differs from the PR. Hover the PR-head line on the left for committed history."
                      : "This local version differs from HEAD. Hover the HEAD line on the left for committed history.",
                }
              : {}),
          },
        },
    layout,
  );
}
