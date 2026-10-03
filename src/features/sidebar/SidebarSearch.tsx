import { Search, X } from "lucide-react";
import type { ThreadSearch } from "./useThreadSearch";
import { ThreadRow, type SidebarRows } from "./SidebarThread";

export function SearchField({ search }: { search: ThreadSearch }) {
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
  search: { results, listed, listAll },
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
          <ThreadRow key={c.id} chat={c} rows={rows} withProject />
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
