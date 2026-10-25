import type { ProjectReplaceResult } from "../../../shared/project-search";
import { FindHeader } from "./FindHeader";
import { FindResults } from "./FindResults";
import { ReplaceReportBox } from "./ReplaceReportBox";
import { emptyResultsNote, statusLine } from "./search-model";
import type { OpenTarget } from "./types";
import { useFindPanel } from "./useFindPanel";
import "./project-search.css";

interface FindInFilesProps {
  /** The workspace to search. */
  where: string;
  /** Starts the field with this (the editor's selection); its first line only. */
  initialQuery?: string;
  /** Shows the replace field. */
  replace?: boolean;
  /** Changes whenever the host asks for the panel again, to focus the field. */
  focusKey?: number;
  /** Names the panel's search, so two panels in one window do not cancel each other. */
  slot?: string;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
  /** Files were rewritten on disk: the host should reload any it has open. */
  onReplaced?: (result: ProjectReplaceResult) => void;
}

/**
 * Find (and replace) in files as a panel for the host to dock: the query
 * with Match case, Words and Regex, file masks, and the matches grouped by
 * file. Replace all asks first, and leaves out files the search saw before
 * they changed.
 */
export function FindInFiles({
  where,
  initialQuery,
  replace = false,
  focusKey,
  slot = "panel",
  onOpen,
  onClose,
  onReplaced,
}: FindInFilesProps) {
  const { fields, flags, toggle, query, result, loading, tree, scope, flow, onKeyDown, problem } =
    useFindPanel({
      where,
      initialQuery,
      replace,
      focusKey,
      slot,
      onOpen,
      onClose,
      onReplaced,
    });

  return (
    <section
      className="ps-find"
      aria-label="Find in files"
      onKeyDown={onKeyDown}
    >
      <FindHeader
        fields={fields}
        flags={flags}
        toggle={toggle}
        hasProblem={!!problem}
        onClose={onClose}
        replaceActions={{
          asking: flow.asking,
          running: flow.running,
          matchCount: scope.matches,
          filesCount: scope.files.length,
          canAsk: !!scope.matches && !loading && !!query,
          onAsk: flow.ask,
          onReplace: () => void flow.replaceAll(),
          onCancel: flow.cancel,
        }}
      />
      <div className="ps-find-line" style={{ padding: "5px 12px 3px" }}>
        <span
          className="ps-find-status"
          role="status"
          data-problem={problem ? "" : undefined}
        >
          {statusLine({ problem, hasQuery: !!query, loading, result })}
        </span>
      </div>
      <FindResults
        tree={tree}
        showReplace={fields.showReplace}
        emptyNote={emptyResultsNote({
          hasQuery: !!query,
          rowCount: tree.rows.length,
          loading,
          problem,
        })}
        onOpen={(index) => {
          const target = tree.openTargetAt(index);
          if (target) onOpen(target);
        }}
      />
      {flow.report && <ReplaceReportBox report={flow.report} />}
    </section>
  );
}
