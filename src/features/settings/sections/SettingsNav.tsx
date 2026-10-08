import type { RefObject } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { PaneResizer } from "../../../ui/PaneResizer";
import {
  SIDEBAR_WIDTH,
  type SettingsCategory,
} from "../../../lib/settings-page";
import type { SettingEntry } from "../settings-search";
import { categories } from "./categories";

/** Settings' own sidebar: back to the app, the search and the categories. */
export function SettingsNav({
  headingId,
  inputRef,
  query,
  setQuery,
  category,
  results,
  showResults,
  onShowResults,
  onPick,
  onClose,
}: {
  headingId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (query: string) => void;
  category: SettingsCategory;
  /** What the search finds, while searching; each category counts its own. */
  results: SettingEntry[] | null;
  showResults: boolean;
  onShowResults: () => void;
  onPick: (category: SettingsCategory) => void;
  onClose: () => void;
}) {
  return (
    <aside className="projects-sidebar settings-nav">
      <PaneResizer pane="sidebar" {...SIDEBAR_WIDTH} />
      <button type="button" className="settings-back" onClick={onClose}>
        <ArrowLeft size={15} />
        <span>Back to app</span>
      </button>
      <h2 id={headingId}>Settings</h2>
      <div className="settings-search">
        <Search size={14} />
        <input
          ref={inputRef}
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <nav aria-label="Settings categories">
        {results && (
          <button
            className={showResults ? "active" : ""}
            aria-current={showResults ? "page" : undefined}
            onClick={onShowResults}
          >
            <Search size={15} />
            <span>Search results</span>
            <small>{results.length}</small>
          </button>
        )}
        {categories.map(({ id, label, icon: Icon }) => {
          const count = results
            ? results.filter((e) => e.category === id).length
            : null;
          return (
            <button
              key={id}
              className={!showResults && category === id ? "active" : ""}
              aria-current={
                !showResults && category === id ? "page" : undefined
              }
              onClick={() => onPick(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {count != null && count > 0 && <small>{count}</small>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
