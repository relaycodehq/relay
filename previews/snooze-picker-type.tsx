// A · Type it: the menu's heading is a field. Typing reads a time as you go
// and puts it on top; presets that match the words stay below it.
import { useState } from "react";
import { CalendarClock, Clock, CornerDownLeft } from "lucide-react";
import { snoozePresets, wakeLabel } from "../shared/chat-activity";
import type { PickerProps } from "./snooze-picker-common";
import { fromNow, parseWhen, whenLabel } from "./snooze-when";

const EXAMPLES = ["45m", "fri 3pm", "next tue", "oct 12"];

interface Row {
  id: string;
  label: string;
  note: string;
  until: number;
  typed?: boolean;
}

export function TypeIt({ onSnooze }: PickerProps) {
  const [now] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const typed = q ? parseWhen(q, now) : null;
  const presets = snoozePresets(now).filter(
    (p) =>
      !q ||
      p.label.toLowerCase().startsWith(q) ||
      p.label
        .toLowerCase()
        .split(" ")
        .some((word) => word.startsWith(q)),
  );
  const rows: Row[] = [
    ...(typed !== null && !presets.some((p) => p.until === typed)
      ? [
          {
            id: "typed",
            label: whenLabel(typed, now),
            note: fromNow(typed, now),
            until: typed,
            typed: true,
          },
        ]
      : []),
    ...presets.map((p) => ({
      id: p.id,
      label: p.label,
      note: wakeLabel(p.until, now),
      until: p.until,
    })),
  ];
  const current = Math.min(active, rows.length - 1);

  return (
    <div className="sp-view sp-type">
      <label className="sp-field">
        <Clock size={14} />
        <input
          data-autofocus
          value={query}
          placeholder="Snooze until…"
          aria-label="Snooze until"
          aria-controls="sp-type-rows"
          aria-activedescendant={
            rows[current] ? `sp-row-${rows[current].id}` : undefined
          }
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((current + step + rows.length) % rows.length);
            } else if (e.key === "Enter" && rows[current]) {
              e.preventDefault();
              onSnooze(rows[current].until);
            }
          }}
        />
      </label>
      <div id="sp-type-rows" role="listbox" aria-label="Wake times">
        {rows.map((row, i) => (
          <div
            key={row.id}
            id={`sp-row-${row.id}`}
            role="option"
            aria-selected={i === current}
            data-active={i === current || undefined}
            className={`sb-menu-item ${row.typed ? "sp-typed" : ""}`}
            onMouseMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSnooze(row.until)}
          >
            <span className="sb-menu-label">
              {row.typed && <CalendarClock size={14} />}
              {row.label}
            </span>
            <small className="sp-note">
              {row.note}
              <CornerDownLeft size={11} className="sp-enter" aria-hidden />
            </small>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="sp-miss">
          Can't read “{query.trim()}” yet. Times like 45m, fri 3pm or oct 12
          work.
        </p>
      )}
      {!q && (
        <p className="sp-hint">
          <span>or type</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery(example);
                setActive(0);
              }}
            >
              {example}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
