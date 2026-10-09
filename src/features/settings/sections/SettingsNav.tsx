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
  projectId,
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
  /** A project category exists only after a project entry point opened it. */
  projectId?: string;
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
        {categories
          .filter((c) => c.id !== "project" || projectId)
          .map(({ id, label, icon: Icon, group }, i, list) => {
            const count = results
              ? results.filter((e) => e.category === id).length
              : null;
            const active = !showResults && category === id;
            const link = (
              <button
                key={id}
                className={
                  [active && "active", group && "settings-nav-sub"]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-current={active ? "page" : undefined}
                onClick={() => onPick(id)}
              >
                {!group && <Icon size={15} />}
                <span>{label}</span>
                {count != null && count > 0 && <small>{count}</small>}
              </button>
            );
            // A group's heading goes before its first page and opens it.
            if (!group || list[i - 1]?.group === group) return link;
            return [
              <button
                key={group.label}
                className="settings-nav-group"
                onClick={() => onPick(id)}
              >
                <group.icon size={15} />
                <span>{group.label}</span>
              </button>,
              link,
            ];
          })}
      </nav>
    </aside>
  );
}
