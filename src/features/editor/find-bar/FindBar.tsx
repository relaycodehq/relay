import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search, TextSelect, X } from "lucide-react";
import type { SearchQuery } from "@codemirror/search";

/** The parts of a query the bar edits. */
export type QueryFields = Pick<
  SearchQuery,
  "search" | "replace" | "caseSensitive" | "wholeWord" | "regexp"
>;

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
  const { query, onQuery } = props;
  // The fields keep their own text, so a keystroke shows at once; a query set
  // from outside (⌘F on a selection) still lands in them.
  const [search, setSearch] = useState(query.search);
  const [replace, setReplace] = useState(query.replace);
  useEffect(() => setSearch(query.search), [query.search]);
  useEffect(() => setReplace(query.replace), [query.replace]);
  const fields: QueryFields = {
    search,
    replace,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    regexp: query.regexp,
  };
  const toggle = (name: "caseSensitive" | "wholeWord" | "regexp") =>
    onQuery({ ...fields, [name]: !query[name] });
  const missing = !!query.search && !props.found;

  return (
    <>
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
            value={search}
            placeholder="Find"
            aria-label="Find"
            spellCheck={false}
            onChange={(event) => {
              setSearch(event.target.value);
              onQuery({ ...fields, search: event.target.value });
            }}
          />
          <BarButton
            label="Match case"
            className="cm-find-toggle"
            pressed={query.caseSensitive}
            onClick={() => toggle("caseSensitive")}
          >
            Aa
          </BarButton>
          <BarButton
            label="Words"
            className="cm-find-toggle"
            pressed={query.wholeWord}
            onClick={() => toggle("wholeWord")}
          >
            W
          </BarButton>
          <BarButton
            label="Regex"
            className="cm-find-toggle"
            pressed={query.regexp}
            onClick={() => toggle("regexp")}
          >
            .*
          </BarButton>
        </div>
        <div className="cm-find-tools">
          <span className={`cm-find-count ${missing ? "missing" : ""}`} aria-live="polite">
            {props.count}
          </span>
          <BarButton label="Previous match" disabled={!props.found} onClick={props.onPrevious}>
            <ArrowUp size={14} />
          </BarButton>
          <BarButton label="Next match" disabled={!props.found} onClick={props.onNext}>
            <ArrowDown size={14} />
          </BarButton>
          <BarButton label="Select all matches" disabled={!props.found} onClick={props.onSelectAll}>
            <TextSelect size={14} />
          </BarButton>
          <span className="cm-find-gap" />
          <BarButton label="Close" onClick={props.onClose}>
            <X size={14} />
          </BarButton>
        </div>
      </div>
      {props.replacing && (
        <div className="cm-find-row">
          <span className="cm-find-indent" />
          <div className="cm-find-field">
            <input
              value={replace}
              placeholder="Replace"
              aria-label="Replace with"
              spellCheck={false}
              onChange={(event) => {
                setReplace(event.target.value);
                onQuery({ ...fields, replace: event.target.value });
              }}
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
      )}
    </>
  );
}
