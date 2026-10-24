import type { RefObject } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconButton } from "./ui";
import "./find-bar.css";

/**
 * A find field with its "2 of 9" count and buttons to step through the
 * matches. Enter goes to the next, Shift+Enter the previous, Esc closes.
 * Where it floats is up to `className`.
 */
export function FindBar({
  input,
  className,
  label,
  query,
  onQuery,
  at,
  count,
  capped = false,
  onStep,
  onClose,
}: {
  input: RefObject<HTMLInputElement | null>;
  className: string;
  /** Its placeholder and accessible name, like "Find in diff". */
  label: string;
  query: string;
  onQuery: (query: string) => void;
  at: number;
  count: number;
  /** There are more than `count`, which reads "1000+". */
  capped?: boolean;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}) {
  return (
    <div className={`find-bar ${className}`} role="search">
      <input
        ref={input}
        value={query}
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="find-bar-count" aria-live="polite">
        {!query
          ? ""
          : count
            ? `${at + 1} of ${count}${capped ? "+" : ""}`
            : "No results"}
      </span>
      <IconButton
        label="Previous match"
        disabled={!count}
        onClick={() => onStep(-1)}
      >
        <ChevronUp size={14} />
      </IconButton>
      <IconButton
        label="Next match"
        disabled={!count}
        onClick={() => onStep(1)}
      >
        <ChevronDown size={14} />
      </IconButton>
      <IconButton label="Close find" onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
