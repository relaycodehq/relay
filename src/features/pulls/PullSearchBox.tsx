import { useEffect, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";

/** The page's search field; the query it reports is trimmed, 250ms after typing stops. */
export function PullSearchBox({
  query,
  onQuery,
  inputRef,
  keys,
}: {
  query: string;
  onQuery: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The shortcut that focuses it, shown while it's empty. */
  keys?: string;
}) {
  const [typed, setTyped] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => onQuery(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);
  return (
    <label className="pulls-search">
      <Search size={13} />
      <input
        ref={inputRef}
        aria-label="Search pull requests"
        placeholder="Search pull requests"
        value={typed}
        maxLength={500}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && typed) {
            e.stopPropagation();
            setTyped("");
          }
        }}
      />
      {typed ? (
        <button
          className="pulls-search-clear"
          aria-label="Clear search"
          onClick={() => setTyped("")}
        >
          <X size={12} />
        </button>
      ) : (
        keys && <kbd>{keys}</kbd>
      )}
    </label>
  );
}
