import { useEffect, useState } from "react";
import type {
  ProjectReplaceResult,
  ProjectSearchFile,
  ProjectSearchQuery,
} from "../../../shared/project-search";
import { errorMessage } from "../../../shared/error-message";
import { api } from "../../lib/api";

type Phase = "idle" | "confirm" | "running";

/** Why a file with edits the editor holds is left out. */
const unsavedReason = "Has unsaved edits. Save it, then search again.";

export type ReplaceReport =
  | { kind: "done"; result: ProjectReplaceResult }
  | { kind: "failed"; message: string };

/**
 * Replace all in three steps: ask (the count to confirm), run, and report
 * what was replaced or why not. Changing the query or the replacement
 * withdraws the question about the old one.
 */
export function useReplaceFlow(input: {
  where: string;
  query: ProjectSearchQuery | null;
  replacement: string;
  /** The files to rewrite, as the search saw them. */
  files: readonly ProjectSearchFile[];
  onReplaced?: (result: ProjectReplaceResult) => void;
  /** The files the host holds unsaved edits in, asked when Replace all runs. */
  unsavedPaths?: () => readonly string[];
  /** Runs the search again, to show what is left and the files that were refused. */
  searchAgain: () => void;
}) {
  const {
    where,
    query,
    replacement,
    files,
    onReplaced,
    unsavedPaths,
    searchAgain,
  } = input;
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<ReplaceReport>();
  useEffect(() => {
    setPhase("idle");
    setReport(undefined);
  }, [query, replacement]);

  async function replaceAll() {
    if (!query) return;
    setPhase("running");
    const unsaved = new Set(unsavedPaths?.());
    const left = files.filter((f) => unsaved.has(f.path));
    const skipped = left.map(({ path }) => ({ path, reason: unsavedReason }));
    try {
      const rewrite = files.filter((f) => !unsaved.has(f.path));
      // The request needs at least one file.
      const done = rewrite.length
        ? await api.replaceProjectText(
            where,
            query,
            replacement,
            rewrite.map(({ path, version }) => ({ path, version })),
          )
        : { replaced: [], skipped: [] };
      setReport({
        kind: "done",
        result: { ...done, skipped: [...done.skipped, ...skipped] },
      });
      if (rewrite.length) onReplaced?.(done);
    } catch (e) {
      setReport({ kind: "failed", message: errorMessage(e) });
    }
    setPhase("idle");
    searchAgain();
  }

  return {
    report,
    asking: phase !== "idle",
    running: phase === "running",
    ask: () => setPhase("confirm"),
    cancel: () => setPhase("idle"),
    replaceAll,
  };
}
