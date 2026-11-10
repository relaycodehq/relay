import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";

/** The page's search field; the query it reports is trimmed, 250ms after typing stops. */
export function PullSearchBox({
  query,
  onQuery,
}: {
  query: string;
  onQuery: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useShortcut("find", true, () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  });
  const keys = useShortcutLabel("find");
  const [typed, setTyped] = useState(query);
  // The query this box last reported; a different one came from outside
  // (Back clearing a search), and the box shows it.
  const reported = useRef(query);
  useEffect(() => {
    if (query === reported.current) return;
    reported.current = query;
    setTyped(query);
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = typed.trim();
      if (next === reported.current) return;
      reported.current = next;
      onQuery(next);
    }, 250);
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
