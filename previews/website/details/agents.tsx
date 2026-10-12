// Demo tiles about agents: what happens when one hits a limit, when you
// switch, when one fans out, and the small cards it puts in front of you.
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  GitBranch,
  Hourglass,
  PanelTop,
  X,
} from "lucide-react";
import { Cursor, Cycle, Kbd, PLACEHOLDER, Placeholder, Type, on, within } from "./kit";
import type { Loop } from "./kit";

/* ---- Limit hit, resumes itself ---- */
export const limitLoop: Loop = { times: [0, 1500, 3000, 3900, 5200, 6800], still: 4 };
export function LimitTile({ s }: { s: number }) {
  return (
    <div className="a-limit">
      <div className="dt-ui a-thread">
        <div className="a-clockline">
          <span className="dt-muted">Thread</span>
          <b className="dt-cycle">
            <Cycle at={s >= 2 ? 1 : 0} items={["14:12", "14:30"]} />
          </b>
        </div>
        <p className="dt-say">Moved the sync worker onto the new queue. 14 of 22 tests pass.</p>
        <p className="dt-say dt-muted">Running the rest of the suite…</p>
        <p className="dt-say dt-in" data-on={on(s, 4)}>
          <Check size={12} className="a-tick" /> All 22 tests pass. Picking up where I stopped.
        </p>
      </div>
      <div className="a-strip" data-live={within(s, 3, 9)}>
        <Hourglass size={14} />
        <span className="a-strip-text">
          <b>Claude hit its usage limit</b>
          <Cycle
            at={s >= 3 ? 1 : 0}
            items={[
              <span key="a" className="dt-muted">· resumes the answer at 14:30</span>,
              <span key="b" className="dt-muted">· resuming the answer</span>,
            ]}
          />
        </span>
        <span className="a-strip-btn">Don't resume</span>
      </div>
      <div className="dt-composer"><Placeholder>{PLACEHOLDER.idle}</Placeholder></div>
    </div>
  );
}

/* ---- Switch agent, with a handoff note ---- */
export const switchLoop: Loop = { times: [0, 1100, 1900, 2700, 4000, 5000, 6900], still: 5 };
export function SwitchTile({ s }: { s: number }) {
  return (
    <div className="a-switch">
      <div className="dt-ui a-dialog dt-out" data-on={on(s, 3)}>
        <h4>Switch to Codex?</h4>
        <p>Claude has been working in this thread. Codex cannot see its session, tool results, or the files it read.</p>
        <p>Claude will write a handoff note first. Codex continues from that note and the recent messages, so expect some context to be lost.</p>
        <div className="a-actions">
          <span className="dt-btn">Keep Claude</span>
          <span className="dt-btn primary" data-press={within(s, 2, 3)}>
            Switch to Codex
          </span>
        </div>
      </div>
      <div className="a-handoff dt-in" data-on={on(s, 3)}>
        <p className="dt-say dt-muted">Claude: Renamed the worker and its tests.</p>
        <div className="dt-divider a-divide">
          <Cycle
            at={s >= 5 ? 2 : s >= 4 ? 1 : 0}
            items={[
              "Claude is writing a handoff note for Codex…",
              <span key="a">Switched from Claude to Codex <i className="a-link">Show note</i></span>,
              <span key="b">Switched from Claude to Codex <i className="a-link">Hide note</i></span>,
            ]}
          />
        </div>
        <div className="a-note" data-open={on(s, 5)}>
          Goal: rename the sync worker. Done: types, tests. Left: update the docs and the README.
        </div>
        <p className="dt-say a-codex dt-in" data-on={on(s, 5)}>
          <b>Codex</b> Picking up from the note: updating the docs now.
        </p>
        <div className="dt-composer a-handoff-composer"><Placeholder>{PLACEHOLDER.working.replace("Claude", "Codex")}</Placeholder></div>
      </div>
      <Cursor
        x={s >= 2 ? 196 : 130}
        y={s >= 2 ? 188 : 120}
        show={s >= 1 && s < 3}
        press={within(s, 2, 3) !== undefined}
      />
    </div>
  );
}

/* ---- An agent starts threads under its own ---- */
export const fanLoop: Loop = { times: [0, 1000, 2200, 3600, 6000], still: 3 };
export function FanTile({ s }: { s: number }) {
  const line = Math.min(s, 3);
  const children = [
    ["Update the login tests", "auth/login-tests"],
    ["Port the token refresh", "auth/token-refresh"],
  ];
  return (
    <div className="a-fan">
      <div className="dt-card">
        <div className="dt-card-top">
          <span className="dt-badge" style={{ ["--hue" as string]: 262 }}>R</span>
          <span className="dt-card-project">Relay</span>
          <span className="dt-card-state" data-kind="working">
            <i /> Working
          </span>
        </div>
        <span className="dt-card-title">Move auth to the new SDK</span>
        <div className="dt-card-meta">
          <span className="a-family dt-in" data-on={on(s, 1)}>
            <ChevronDown size={11} />
            <Cycle
              at={line}
              items={[
                "",
                "1 thread · 1 working",
                "2 threads · 2 working",
                "2 threads · 1 working · 1 needs you",
              ]}
            />
          </span>
        </div>
      </div>
      <div className="a-started">
        {children.map(([title, branch], i) => {
          const waiting = i === 1 && s >= 3;
          return (
            <div className="dt-card compact dt-in" data-on={on(s, i + 1)} key={title}>
              <div className="dt-card-top">
                <span className="dt-card-title">{title}</span>
                <span className="dt-card-state" data-kind={waiting ? "waiting" : "working"}>
                  {waiting ? "Needs input" : <><i /> Working</>}
                </span>
              </div>
              <div className="dt-card-meta">
                <GitBranch size={11} /> <span>{branch}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Steer while it works ---- */
export const steerLoop: Loop = { times: [0, 700, 2200, 3300, 4300, 5600, 7000], still: 5 };
export function SteerTile({ s }: { s: number }) {
  return (
    <div className="a-steer">
      <div className="dt-ui a-trace">
        <div className="a-step">
          <Check size={12} /> <span className="dt-muted">Read db/config.ts</span>
        </div>
        <div className="a-step" data-live>
          <span className="dt-spin" />
          <Cycle
            at={s >= 4 ? 1 : 0}
            items={["Running the migration on production", "Running the migration on staging"]}
          />
        </div>
        <p className="dt-say a-reply dt-in" data-on={on(s, 4)}>
          Switched to the staging database.
        </p>
      </div>
      <div className="a-bubble dt-in" data-on={on(s, 4)}>
        Use the staging database
      </div>
      <section className="a-queued dt-in" data-on={within(s, 2, 4)}>
        <header>
          <Clock3 size={13} /> Queued · sends after this answer
        </header>
        <div className="a-qrow">
          <span className="a-qtext">Use the staging database</span>
          <span className="a-qbtn" data-hot={within(s, 3, 4)}>
            <ArrowUp size={13} />
          </span>
          <span className="a-qbtn">
            <X size={13} />
          </span>
        </div>
        <p className="a-qhint">
          <Kbd>↵</Kbd> to queue · <Kbd>⌘↵</Kbd> to steer
        </p>
      </section>
      <div className="dt-composer a-steer-composer">
        <span className="a-typed dt-swap" data-on={on(s, 2)}>
          <span>
            <Type text="Use the staging database" go={s >= 1} ms={1300} />
          </span>
          <Placeholder>{PLACEHOLDER.working}</Placeholder>
        </span>
      </div>
      <Cursor x={s >= 2 ? 248 : 170} y={s >= 2 ? 140 : 170} show={s >= 2 && s < 4} press={within(s, 3, 4) !== undefined} />
    </div>
  );
}

/* ---- The agent asks with its own page ---- */
export const askLoop: Loop = { times: [0, 1000, 1700, 2600, 3100, 3700, 6000], still: 3 };
const layouts: [string, string][] = [
  ["Tabs", "One section at a time"],
  ["Sidebar", "All sections in a list"],
  ["One long page", "Scroll through everything"],
];
export function AskTile({ s }: { s: number }) {
  const picked = s >= 2 ? 1 : -1;
  return (
    <div className="a-ask">
      <div className="dt-swap a-stack" data-on={on(s, 5)}>
      <div className="dt-ui a-req">
        <header>
          <PanelTop size={14} />
          <strong>Which layout for the settings page?</strong>
        </header>
        <div className="a-page">
          {layouts.map(([name, hint], i) => (
            <div className="a-opt" data-on={picked === i || undefined} key={name}>
              <i />
              <span>
                <b>{name}</b>
                <small>{hint}</small>
              </span>
            </div>
          ))}
        </div>
        <footer>
          <span className="dt-btn">Skip</span>
          <span
            className="dt-btn primary"
            data-off={s < 2 || undefined}
            data-press={within(s, 4, 5)}
          >
            Send answer
          </span>
        </footer>
      </div>
      <div className="a-answered">
        <div className="dt-divider">
          <span>You answered “Layout for the settings page”</span>
        </div>
      </div>
      </div>
      <Cursor
        x={s >= 3 ? 226 : s >= 1 ? 120 : 90}
        y={s >= 3 ? 188 : s >= 1 ? 112 : 70}
        show={s >= 1 && s < 5}
        press={within(s, 4, 5) !== undefined}
      />
    </div>
  );
}

/* ---- "You should know" after a turn ---- */
export const knowLoop: Loop = { times: [0, 900, 2600, 3300, 4700, 6200], still: 1 };
export function KnowTile({ s }: { s: number }) {
  return (
    <div className="a-know">
      <p className="dt-say">
        <Check size={12} className="a-tick" /> Done. The new migration adds the <code>sessions</code> index and drops
        the old <code>tokens</code> table.
      </p>
      <aside className="a-watch dt-in" data-on={within(s, 1, 4)}>
        <div>
          <header>
            <Eye size={13} />
            <b>You should know</b>
            <span>this turn</span>
            <X size={13} className="a-x" />
          </header>
          <p>Dropping tokens signs everyone out when this deploys.</p>
          <div className="a-watch-actions">
            <span data-hot={undefined}>Learn more</span>
            <span>Tell Claude</span>
            <span className="dt-btn" data-hot={within(s, 2, 4)} data-press={within(s, 3, 4)}>
              I know this
            </span>
          </div>
        </div>
      </aside>
      <div className="dt-composer a-know-composer"><Placeholder>{PLACEHOLDER.idle}</Placeholder></div>
      <Cursor x={s >= 2 ? 176 : 120} y={s >= 2 ? 150 : 130} show={s >= 2 && s < 4} press={within(s, 3, 4) !== undefined} />
    </div>
  );
}

/* ---- /btw: a side question in its own thread ---- */
export const btwLoop: Loop = { times: [0, 500, 2200, 3100, 4600, 5400, 7200], still: 4 };
export function BtwTile({ s }: { s: number }) {
  return (
    <div className="a-btw">
      <p className="dt-say a-main">
        <span className="dt-spin" /> Updating the migration…
      </p>
      <div className="a-side dt-in" data-on={on(s, 2)}>
        <p>Is the cache shared between tabs?</p>
        <div className="a-sidebar">
          <span className="a-face">C</span>
          <Cycle
            at={s >= 4 ? 1 : 0}
            items={[
              <span key="a" className="dt-muted">Codex is answering…</span>,
              <span key="b">
                <strong>1 reply</strong> <span className="dt-muted">Last reply 13:31</span>
              </span>,
            ]}
          />
          <span className="a-view dt-in" data-on={on(s, 5)}>View thread ›</span>
        </div>
      </div>
      <div className="dt-composer a-btw-composer">
        <span className="dt-swap" data-on={on(s, 2)}>
          <span>
            <Type text="/btw Is the cache shared between tabs?" go={s >= 1} ms={1500} />
          </span>
          <Placeholder>{PLACEHOLDER.working}</Placeholder>
        </span>
        <span className="dt-send" data-press={within(s, 2, 3)}>
          <ArrowUp size={13} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}
