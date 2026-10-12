// Demo tiles about threads: snoozing, sending later, settling, notes, the
// queue and quoting an answer.
import {
  ArrowUp,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  GitBranch,
  GitPullRequest,
  GripVertical,
  Pin,
  TextQuote,
} from "lucide-react";
import { Cursor, Cycle, Kbd, PLACEHOLDER, Placeholder, Type, on, within } from "./kit";
import type { Loop } from "./kit";

const hue = (h: number) => ({ ["--hue" as string]: h });
const slot = (n: number) => ({ transform: `translateY(${n * 62}px)` });
const is = (v: string | undefined) => v !== undefined;

/* ---- Snooze ---- */
export const snoozeLoop: Loop = { times: [0, 900, 1800, 3000, 3700, 4800, 6400], still: 5 };
export function SnoozeTile({ s }: { s: number }) {
  const gone = s >= 4;
  const cards = [
    ["Fix flaky sync test", "9 min", 262],
    ["Rename the sync worker", "4 min", 190],
    ["Draft the release notes", "1 h", 28],
  ] as const;
  return (
    <div className="t-snooze">
      <div className="t-list">
        {cards.map(([title, age, h], i) => {
          const target = i === 1;
          return (
            <div
              className="dt-card t-slot"
              data-hover={target ? within(s, 1, 4) : undefined}
              data-gone={target && gone ? "" : undefined}
              style={slot(gone && i > 1 ? i - 1 : i)}
              key={title}
            >
              <div className="dt-card-top">
                <span className="dt-badge" style={hue(h)}>R</span>
                <span className="dt-card-project">Relay</span>
                <span className="dt-swap t-state" data-on={target ? on(s, 1) : undefined}>
                  <span className="dt-card-state" data-kind="unread"><i /> {age}</span>
                  <span className="t-actions">
                    <Clock size={14} data-hot={within(s, 2, 4)} />
                    <Check size={14} />
                  </span>
                </span>
              </div>
              <span className="dt-card-title">{title}</span>
            </div>
          );
        })}
        <div className="t-shelf dt-in" data-on={on(s, 5)} style={{ top: 134 }}>
          <span>Snoozed <b>1</b></span>
          <hr />
          <ChevronRight size={12} />
        </div>
      </div>
      <div className="dt-menu t-snooze-menu t-pop-menu" data-open={within(s, 2, 4)}>
        <div className="dt-menu-heading">Snooze until…</div>
        {[
          ["15 minutes", "17:40"],
          ["1 hour", "18:25"],
          ["3 hours", "20:25"],
          ["Tomorrow", "tomorrow 9:00"],
          ["Next week", "Mon 9:00"],
        ].map(([label, when]) => (
          <div className="dt-menu-item" data-hot={label === "Tomorrow" && s >= 3 ? "" : undefined} key={label}>
            <span>{label}</span>
            <small>{when}</small>
          </div>
        ))}
        <div className="dt-menu-sep" />
        <div className="dt-menu-item">
          <span className="t-label"><CalendarClock size={13} /> Pick a time…</span>
          <ChevronRight size={13} />
        </div>
      </div>
      <Cursor x={s >= 3 ? 190 : 252} y={s >= 1 ? (s >= 3 ? 168 : 98) : 150} show={s >= 1 && s < 5} press={is(within(s, 2, 3)) || is(within(s, 3, 4))} />
    </div>
  );
}

/* ---- Send later ---- */
export const laterLoop: Loop = { times: [0, 900, 1700, 2700, 3400, 4600, 6400], still: 5 };
export function LaterTile({ s }: { s: number }) {
  return (
    <div className="t-later">
      <p className="dt-say"><Check size={12} className="a-tick" /> Tests are green. Ready for the fix whenever you are.</p>
      <section className="t-queue dt-in" data-on={on(s, 4)}>
        <header><CalendarClock size={13} /> Scheduled</header>
        <div className="t-bubble">
          <p>Ship the fix after the tests pass</p>
          <small>Sends tomorrow 9:00</small>
        </div>
      </section>
      <div className="dt-menu t-later-menu t-pop-menu" data-open={within(s, 2, 4)}>
        <div className="dt-menu-heading">Send later…</div>
        {[
          ["In 30 minutes", "13:10"],
          ["In 1 hour", "13:40"],
          ["In 3 hours", "15:40"],
          ["This evening", "18:00"],
          ["Tomorrow morning", "tomorrow 9:00"],
        ].map(([label, when]) => (
          <div className="dt-menu-item" data-hot={label === "Tomorrow morning" && s >= 3 ? "" : undefined} key={label}>
            <span>{label}</span>
            <small>{when}</small>
          </div>
        ))}
        <div className="dt-menu-sep" />
        <div className="dt-menu-item">
          <span className="t-label"><CalendarClock size={13} /> Pick a time…</span>
        </div>
      </div>
      <div className="dt-composer">
        <span className="dt-swap t-grow" data-on={on(s, 4)}>
          <span className="t-nowrap">Ship the fix after the tests pass</span>
          <Placeholder>{PLACEHOLDER.idle}</Placeholder>
        </span>
        <span className="dt-send" data-press={within(s, 1, 2)}>
          <ArrowUp size={13} strokeWidth={2.5} />
        </span>
      </div>
      <Cursor x={s >= 3 ? 190 : 258} y={s >= 3 ? 146 : 212} show={s >= 1 && s < 5} press={is(within(s, 1, 2)) || is(within(s, 3, 4))} />
    </div>
  );
}

/* ---- Threads settle on their own ---- */
export const settleLoop: Loop = { times: [0, 1100, 2000, 3300, 4300, 5600, 7200], still: 5 };
export function SettleTile({ s }: { s: number }) {
  const first = s >= 2;
  const second = s >= 4;
  return (
    <div className="t-settle">
      <div className="t-list">
        <div className="dt-card t-slot" style={slot(0)} data-gone={first ? "" : undefined}>
          <div className="dt-card-top">
            <span className="dt-badge" style={hue(262)}>R</span>
            <span className="dt-card-project">Relay</span>
            <span className="dt-card-state">12 min</span>
          </div>
          <span className="dt-card-title">Fix flaky sync test</span>
          <div className="dt-card-meta">
            <GitPullRequest size={11} />
            <span>#214</span>
          </div>
        </div>
        <div className="dt-card t-slot" style={slot(first ? 0 : 1)} data-gone={second ? "" : undefined}>
          <div className="dt-card-top">
            <span className="dt-badge" style={hue(190)}>R</span>
            <span className="dt-card-project">Relay</span>
            <span className="dt-card-state">3 d</span>
          </div>
          <span className="dt-card-title">Draft the release notes</span>
        </div>
        <div className="t-shelf2">
          <div className="t-shelf dt-in" data-on={on(s, 2)}>
            <span>Settled <b><Cycle at={second ? 1 : 0} items={["1", "2"]} /></b></span>
            <hr />
            <ChevronRight size={12} />
          </div>
          <div className="t-compact dt-in" data-on={on(s, 2)}>
            <span className="dt-badge" style={hue(262)}>R</span>
            <span className="t-compact-title">Fix flaky sync test</span>
            <small>12 min</small>
          </div>
          <div className="t-compact dt-in" data-on={on(s, 4)}>
            <span className="dt-badge" style={hue(190)}>R</span>
            <span className="t-compact-title">Draft the release notes</span>
            <small>3 d</small>
          </div>
          <div className="t-tip dt-in" data-on={within(s, 3, 4)} style={{ top: 2 }}>
            Settled when its PR merged
          </div>
          <div className="t-tip dt-in" data-on={within(s, 5, 6)} style={{ top: 32 }}>
            Settled after days without activity
          </div>
        </div>
      </div>
      <Cursor
        x={150}
        y={s >= 5 ? 214 : 184}
        show={(s >= 3 && s < 4) || (s >= 5 && s < 6)}
        press={false}
      />
    </div>
  );
}

/* ---- Pin an answer or a list as notes ---- */
export const notesLoop: Loop = { times: [0, 800, 1500, 2300, 3400, 4400, 5400, 7300], still: 6 };
const todo = ["Rotate the signing key", "Run the migration on staging", "Tell support about the sign-out"];
export function NotesTile({ s }: { s: number }) {
  return (
    <div className="t-notes">
      <div className="t-answer">
        <p className="dt-say">Before you ship:</p>
        <div className="t-mdlist" data-hover={within(s, 1, 3)}>
          <ol>
            {todo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <span className="t-keep" data-pinned={on(s, 2)}>
            <Pin size={13} />
          </span>
        </div>
      </div>
      <div className="dt-ui t-notecard" data-open={within(s, 3, 7)}>
        <div className="t-notehead"><b>Notes</b></div>
        <ol className="t-items">
          {todo.map((item, i) => (
            <li key={item} data-done={(i === 0 && s >= 5) || (i === 1 && s >= 6) ? "" : undefined}>
              <span className="t-tick"><Check size={9} strokeWidth={3} /></span>
              <span className="t-n">{i + 1}</span>
              <span className="t-text">{item}</span>
            </li>
          ))}
        </ol>
        <div className="t-foot">
          <Cycle at={s >= 6 ? 2 : s >= 5 ? 1 : 0} items={["3 of 3 remaining", "2 of 3 remaining", "1 of 3 remaining"]} />
        </div>
      </div>
      <div className="t-bottom">
        <div className="dt-composer">
          <Placeholder>{PLACEHOLDER.idle}</Placeholder>
          <span className="dt-send"><ArrowUp size={13} strokeWidth={2.5} /></span>
        </div>
        <div className="t-ctx">
          <span className="t-branch"><GitBranch size={12} /> relay/sync-worker</span>
          <span className="t-chip dt-in" data-on={on(s, 2)} data-open={within(s, 3, 7)}>
            <Pin size={13} />
            <span>1</span>
          </span>
        </div>
      </div>
      <Cursor
        x={s >= 5 ? 44 : s >= 3 ? 262 : s >= 2 ? 242 : s >= 1 ? 190 : 120}
        y={s >= 6 ? 106 : s >= 5 ? 80 : s >= 3 ? 204 : s >= 2 ? 82 : s >= 1 ? 100 : 160}
        show={s >= 1 && s < 7}
        press={is(within(s, 2, 3)) || is(within(s, 5, 6)) || is(within(s, 6, 7))}
      />
    </div>
  );
}

/* ---- Queue, reorder ---- */
export const queueLoop: Loop = { times: [0, 900, 1700, 2300, 3300, 3900, 5800], still: 5 };
const queued = ["Update the changelog", "Open a PR when it's green", "Run the full suite first"];
export function QueueTile({ s }: { s: number }) {
  // Where each message sits once the third has been dragged to the top.
  const order = s >= 3 ? [1, 2, 0] : [0, 1, 2];
  const lifted = s >= 2 && s < 4;
  return (
    <div className="t-queueing">
      <header className="t-queue-head">
        <Clock size={13} /> 3 queued · sent one by one after this answer
      </header>
      <div className="t-qlist">
        <div className="t-gutter">
          {[1, 2, 3].map((n, i) => (
            <span key={n}>{i === order[2] && s >= 1 && s < 4 ? <GripVertical size={13} /> : n}</span>
          ))}
        </div>
        {queued.map((text, i) => (
          <div
            className="t-qrow"
            data-lift={i === 2 && lifted ? "" : undefined}
            style={{ transform: `translateY(${order[i]! * 48}px)` }}
            key={text}
          >
            <div className="t-qbubble">{text}</div>
          </div>
        ))}
      </div>
      <p className="t-hint"><Kbd>↵</Kbd> to queue · <Kbd>⌘↵</Kbd> to steer</p>
      <Cursor x={s >= 1 ? 120 : 200} y={s >= 3 ? 64 : s >= 1 ? 160 : 130} show={s >= 1 && s < 5} press={lifted} />
    </div>
  );
}

/* ---- Quote a selection into your reply ---- */
export const quoteLoop: Loop = { times: [0, 700, 1300, 2500, 3300, 3900, 6200], still: 5 };
export function QuoteTile({ s }: { s: number }) {
  return (
    <div className="t-quote">
      <div className="dt-ui t-prose">
        <p>
          Entries are{" "}
          <span className="t-sel" data-on={on(s, 2)}>
            keyed by tab id, so two tabs never share an entry
          </span>
          . Clearing one leaves the other alone.
        </p>
      </div>
      <div className="t-pop dt-in" data-on={within(s, 3, 5)}>
        <span className="t-pop-btn" data-hot={within(s, 4, 5)}>
          <TextQuote size={13} /> Add to chat <Kbd>⌘L</Kbd>
        </span>
        <span className="t-pop-btn">
          <Pin size={12} /> Keep
        </span>
      </div>
      <div className="t-composer">
        <div className="t-qblock dt-in" data-on={on(s, 5)}>
          <TextQuote size={12} />
          <span>keyed by tab id, so two tabs never share an entry</span>
        </div>
        <div className="dt-composer">
          <span className="t-grow dt-muted">
            <Type text="Does that hold for incognito too?" go={s >= 5} ms={900} delay={400} />
          </span>
          <span className="dt-send"><ArrowUp size={13} strokeWidth={2.5} /></span>
        </div>
      </div>
      <Cursor
        x={s >= 4 ? 118 : s >= 2 ? 140 : s >= 1 ? 84 : 60}
        y={s >= 4 ? 22 : s >= 2 ? 90 : s >= 1 ? 70 : 60}
        show={s >= 1 && s < 6}
        press={is(within(s, 1, 2)) || is(within(s, 4, 5))}
      />
    </div>
  );
}
