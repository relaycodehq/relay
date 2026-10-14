// Demo tiles about threads: handing one to another computer, snoozing,
// sending later and notes.
import {
  ArrowUp,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  GitBranch,
  Monitor,
  MonitorUp,
  Pin,
  Server,
} from "lucide-react";
import { Cursor, Cycle, PLACEHOLDER, Placeholder, Type, on, within } from "./kit";
import type { Loop } from "./kit";

const hue = (h: number) => ({ ["--hue" as string]: h });
const slot = (n: number) => ({ transform: `translateY(${n * 62}px)` });
const is = (v: string | undefined) => v !== undefined;

/* ---- Hand a running thread to another computer ---- */
export const handoffLoop: Loop = {
  times: [0, 700, 1500, 2200, 2800, 3900, 5300, 6000, 8400],
  still: 7,
};
const computers: [name: string, Icon: typeof Server][] = [
  ["macmini", Server],
  ["lubopc", Monitor],
];
export function HandoffTile({ s }: { s: number }) {
  const away = s >= 4;
  return (
    <div className="t-handoff">
      <div className="t-hhead">
        <span>Move webhooks to the queue</span>
        <span className="t-hbtn" data-hot={within(s, 1, 4)} data-press={within(s, 2, 3)}>
          <MonitorUp size={13} />
        </span>
      </div>
      <div className="dt-menu t-hmenu dt-in" data-on={within(s, 2, 4)}>
        <div className="dt-menu-heading">Hand off to</div>
        {computers.map(([name, Icon], i) => (
          <div className="dt-menu-item t-hrow" data-hot={i === 0 ? within(s, 3, 4) : undefined} key={name}>
            <Icon size={14} />
            <span>
              {name}
              <small>Continues in Relay</small>
            </span>
          </div>
        ))}
      </div>
      <p className="dt-say t-hline">
        {away ? <Check size={12} className="t-htick" /> : <span className="dt-spin" />}
        <Cycle
          at={away ? 1 : 0}
          items={["Moving the webhooks to the new queue…", "Wrote a handoff note for macmini"]}
        />
      </p>
      <div className="dt-divider dt-in" data-on={on(s, 4)}>
        <span>Continued on macmini · 14:02</span>
      </div>
      <p className="dt-bubble dt-in" data-on={on(s, 6)}>
        Also run the e2e suite
      </p>
      <p className="dt-say t-hline dt-in" data-on={on(s, 7)}>
        <span className="dt-spin" /> Running the e2e suite on macmini…
      </p>
      <div className="t-hfoot">
        <div className="t-away dt-in" data-on={on(s, 4)}>
          <MonitorUp size={12} />
          <span>Running on macmini</span>
          <b>Bring back</b>
        </div>
        <div className="dt-composer">
          <span className="dt-swap" data-on={within(s, 5, 6)}>
            <Placeholder>{PLACEHOLDER.working}</Placeholder>
            <span>
              <Type text="Also run the e2e suite" go={s >= 5} ms={1000} />
            </span>
          </span>
        </div>
      </div>
      <Cursor
        x={s >= 3 ? 150 : 268}
        y={s >= 3 ? 70 : 22}
        show={s >= 1 && s < 4}
        press={within(s, 2, 3) !== undefined || within(s, 3, 4) !== undefined}
      />
    </div>
  );
}

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
