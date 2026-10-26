import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search, TextSelect, X } from "lucide-react";
import type { SearchQuery } from "@codemirror/search";
import { useQueryFields, type QueryFields } from "./useQueryFields";

export type FindBarProps = {
  query: SearchQuery;
  /** "3/12", "12 results" or "0 results". */
  count: string;
  found: boolean;
  /** The replace row is open. */
  replacing: boolean;
  /** Absent in a read-only editor. */
  onToggleReplace: (() => void) | undefined;
  onQuery: (fields: QueryFields) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSelectAll: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
};

function BarButton({
  label,
  onClick,
  disabled,
  pressed,
  className = "cm-find-button",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keeps the caret in the field, as PhpStorm's toggles do.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** PhpStorm's find bar: one row to find, a second to replace. */
export function FindBar(props: FindBarProps) {
  const fields = useQueryFields(props.query, props.onQuery);

  return (
    <>
      <FindRow {...props} fields={fields} />
      {props.replacing && <ReplaceRow {...props} fields={fields} />}
    </>
  );
}

type Fields = ReturnType<typeof useQueryFields>;

function FindRow(props: FindBarProps & { fields: Fields }) {
  const { query, fields } = props;
  const missing = !!query.search && !props.found;

  return (
    <div className="cm-find-row">
      {props.onToggleReplace ? (
        <BarButton
          label={props.replacing ? "Hide replace" : "Show replace"}
          className="cm-find-button cm-find-expand"
          pressed={props.replacing}
          onClick={props.onToggleReplace}
        >
          <ChevronRight size={14} />
        </BarButton>
      ) : (
        <Search size={13} className="cm-find-icon" />
      )}
      <div className={`cm-find-field ${missing ? "missing" : ""}`}>
        <input
          main-field="true"
          value={fields.search}
          placeholder="Find"
          aria-label="Find"
          spellCheck={false}
          onChange={(event) => fields.typeSearch(event.target.value)}
        />
        <BarButton
          label="Match case"
          className="cm-find-toggle"
          pressed={query.caseSensitive}
          onClick={() => fields.toggle("caseSensitive")}
        >
          Aa
        </BarButton>
        <BarButton
          label="Words"
          className="cm-find-toggle"
          pressed={query.wholeWord}
          onClick={() => fields.toggle("wholeWord")}
        >
          W
        </BarButton>
        <BarButton
          label="Regex"
          className="cm-find-toggle"
          pressed={query.regexp}
          onClick={() => fields.toggle("regexp")}
        >
          .*
        </BarButton>
      </div>
      <MatchTools {...props} missing={missing} />
    </div>
  );
}

function MatchTools(props: FindBarProps & { missing: boolean }) {
  return (
    <div className="cm-find-tools">
      <span
        className={`cm-find-count ${props.missing ? "missing" : ""}`}
        aria-live="polite"
      >
        {props.count}
      </span>
      <BarButton
        label="Previous match"
        disabled={!props.found}
        onClick={props.onPrevious}
      >
        <ArrowUp size={14} />
      </BarButton>
      <BarButton
        label="Next match"
        disabled={!props.found}
        onClick={props.onNext}
      >
        <ArrowDown size={14} />
      </BarButton>
      <BarButton
        label="Select all matches"
        disabled={!props.found}
        onClick={props.onSelectAll}
      >
        <TextSelect size={14} />
      </BarButton>
      <span className="cm-find-gap" />
      <BarButton label="Close" onClick={props.onClose}>
        <X size={14} />
      </BarButton>
    </div>
  );
}

function ReplaceRow(props: FindBarProps & { fields: Fields }) {
  return (
    <div className="cm-find-row">
      <span className="cm-find-indent" />
      <div className="cm-find-field">
        <input
          value={props.fields.replace}
          placeholder="Replace"
          aria-label="Replace with"
          spellCheck={false}
          onChange={(event) => props.fields.typeReplace(event.target.value)}
        />
      </div>
      <div className="cm-find-tools">
        <BarButton
          label="Replace"
          className="cm-find-word"
          disabled={!props.found}
          onClick={props.onReplace}
        >
          Replace
        </BarButton>
        <BarButton
          label="Replace all"
          className="cm-find-word"
          disabled={!props.found}
          onClick={props.onReplaceAll}
        >
          Replace all
        </BarButton>
      </div>
    </div>
  );
}
