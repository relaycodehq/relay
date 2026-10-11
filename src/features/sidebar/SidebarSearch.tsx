import { Search, X } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import type { ThreadSearch } from "./useThreadSearch";
import { ThreadRow, type SidebarRows } from "./SidebarThread";

export function SearchField({
  search,
  onOpen,
}: {
  search: ThreadSearch;
  onOpen: (chat: ChatSummary) => void;
}) {
  return (
    <label className="sb-search">
      <Search size={13} />
      <input
        aria-label="Search threads"
        placeholder="Search"
        value={search.text}
        onChange={(e) => search.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") search.setText("");
          if (!search.query || e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            search.move(e.key === "ArrowDown" ? 1 : -1);
          }
          if (e.key === "Enter" && search.highlighted) {
            e.preventDefault();
            onOpen(search.highlighted);
          }
        }}
      />
      {search.text && (
        <button
          className="sb-search-clear"
          aria-label="Clear search"
          onClick={() => search.setText("")}
        >
          <X size={12} />
        </button>
      )}
    </label>
  );
}

/** The threads matching the search, across projects, in place of the view. */
export function SearchResults({
  search: { results, listed, listAll, highlighted },
  rows,
}: {
  search: ThreadSearch;
  rows: SidebarRows;
}) {
  return (
    <>
      <div className="sb-view-heading">
        <h2>Results</h2>
        <small>{results.length}</small>
      </div>
      <div className="sb-thread-list flat">
        {listed.map((c) => (
          <ThreadRow
            key={c.id}
            chat={c}
            rows={rows}
            withProject
            highlighted={c === highlighted}
          />
        ))}
        {listed.length < results.length && (
          <button className="sb-thread sb-ghost" onClick={listAll}>
            <span className="sb-thread-title">
              Show {results.length - listed.length} more
            </span>
          </button>
        )}
      </div>
      {!results.length && <p className="sb-note">No matching threads.</p>}
    </>
  );
}
