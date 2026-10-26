import { useMemo } from "react";
import type { LocalHistoryEntry } from "../../../shared/local-history";
import { groupByDay, reasonText, sizeText, timeText } from "./history-days";

/** The versions under the day they were kept, newest first; the arrow keys move the selection. */
export function HistoryList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: LocalHistoryEntry[];
  selectedId?: string;
  onSelect(id: string): void;
}) {
  const days = useMemo(() => groupByDay(entries), [entries]);
  const inShownOrder = useMemo(() => days.flatMap((d) => d.entries), [days]);

  function step(e: React.KeyboardEvent, by: number) {
    const at = inShownOrder.findIndex((x) => x.id === selectedId);
    const last = inShownOrder.length - 1;
    const next = inShownOrder[Math.min(last, Math.max(0, at + by))];
    if (!next) return;
    e.preventDefault();
    onSelect(next.id);
    document.getElementById(`lh-${next.id}`)?.focus();
  }

  return (
    <ul
      className="lh-list"
      aria-label="Versions"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") step(e, 1);
        else if (e.key === "ArrowUp") step(e, -1);
      }}
    >
      {days.map((day) => (
        <li key={day.title} className="lh-day">
          <h3>{day.title}</h3>
          <ul>
            {day.entries.map((entry) => (
              <li key={entry.id}>
                <button
                  id={`lh-${entry.id}`}
                  type="button"
                  className="lh-row"
                  aria-current={entry.id === selectedId}
                  onClick={() => onSelect(entry.id)}
                >
                  <span className="lh-time">{timeText(entry.time)}</span>
                  <span className="lh-what">
                    {entry.label ?? reasonText[entry.reason]}
                  </span>
                  <span className="lh-meta">
                    {entry.label ? `${reasonText[entry.reason]} · ` : ""}
                    {entry.skipped ? "Too large to keep" : sizeText(entry.size)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
