import { ChevronDown, ChevronRight, X } from "lucide-react";
import { IconButton } from "../../ui/ui";
import { fileCount } from "./search-model";
import type { SearchFlags } from "./search-options";
import { SearchToggles } from "./SearchToggles";
import type { FindFields } from "./useFindFields";

interface ReplaceActionsProps {
  asking: boolean;
  running: boolean;
  matchCount: number;
  /** The search stopped at its cap, so a file listed may hold more matches than shown. */
  moreMatches: boolean;
  filesCount: number;
  canAsk: boolean;
  onAsk: () => void;
  onReplace: () => void;
  onCancel: () => void;
}

/** The replace-all button, which turns into "Replace N matches in M files?" with Replace and Cancel. */
function ReplaceActions(props: ReplaceActionsProps) {
  const { asking, running, matchCount, moreMatches, filesCount } = props;
  if (!asking)
    return (
      <div className="ps-replace-actions">
        <button type="button" disabled={!props.canAsk} onClick={props.onAsk}>
          Replace all
        </button>
      </div>
    );
  return (
    <div className="ps-replace-actions">
      <span className="ps-confirm">
        Replace {matchCount}
        {moreMatches ? "+" : ""}{" "}
        {matchCount === 1 && !moreMatches ? "match" : "matches"} in{" "}
        {fileCount(filesCount)}?
      </span>
      <button type="button" disabled={running} onClick={props.onReplace}>
        Replace
      </button>
      <button type="button" disabled={running} onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** The two fields that narrow the search to some files, or leave some out. */
function FileMasks({ fields }: { fields: FindFields }) {
  return (
    <div className="ps-find-masks">
      <div className="ps-field">
        <input
          aria-label="Files to include"
          placeholder="Files: *.ts, src/**"
          value={fields.include}
          spellCheck={false}
          onChange={(e) => fields.setInclude(e.target.value)}
        />
      </div>
      <div className="ps-field">
        <input
          aria-label="Files to exclude"
          placeholder="Not in: dist, *.test.ts"
          value={fields.exclude}
          spellCheck={false}
          onChange={(e) => fields.setExclude(e.target.value)}
        />
      </div>
    </div>
  );
}

/** The find field with its switches, the replace field, and the two file masks. */
export function FindHeader(props: {
  fields: FindFields;
  flags: SearchFlags;
  toggle: Record<keyof SearchFlags, () => void>;
  hasProblem: boolean;
  replaceActions: ReplaceActionsProps;
  onClose: () => void;
}) {
  const { fields, flags, toggle, hasProblem } = props;
  return (
    <div className="ps-find-head">
      <div className="ps-find-line">
        <IconButton
          label={fields.showReplace ? "Hide replace" : "Show replace"}
          active={false}
          onClick={() => fields.setShowReplace((on) => !on)}
        >
          {fields.showReplace ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </IconButton>
        <div className="ps-field" data-problem={hasProblem ? "" : undefined}>
          <input
            ref={fields.findInput}
            className="mono"
            aria-label="Find in files"
            placeholder="Find in files"
            value={fields.find}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => fields.setFind(e.target.value)}
          />
          <SearchToggles flags={flags} toggle={toggle} />
        </div>
        <IconButton label="Close search" onClick={props.onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {fields.showReplace && (
        <div className="ps-find-line">
          <span className="ps-gutter" />
          <div className="ps-field">
            <input
              className="mono"
              aria-label="Replace with"
              placeholder="Replace with"
              value={fields.replacement}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => fields.setReplacement(e.target.value)}
            />
          </div>
          <ReplaceActions {...props.replaceActions} />
        </div>
      )}
      <FileMasks fields={fields} />
    </div>
  );
}
