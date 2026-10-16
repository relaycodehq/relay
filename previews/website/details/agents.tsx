// Demo tiles about agents: what happens when one hits a limit, when you
// switch, what it can do in Relay for you, voice, and the cards it puts in
// front of you.
import { ArrowUp, Check, Eye, Hourglass, Mic, Square, Volume2, X } from "lucide-react";
import { Cursor, Cycle, PLACEHOLDER, Placeholder, Type, on, within } from "./kit";
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

/* ---- Ask the agent to run Relay through its tools ---- */
export const driveLoop: Loop = {
  times: [0, 300, 900, 1800, 2700, 3200, 4000, 4900, 5400, 6200, 8600],
  still: 9,
};
const asks: [ask: string, tool: string, result: string][] = [
  ["Give each failing test its own thread", "start_threads", "Started 3 threads"],
  ["How much of my week is left?", "usage_limits", "Claude 62% · Codex 81%"],
  ["Hand this thread to my desktop at home", "hand_off_thread", "Continued on studio"],
];
export function DriveTile({ s }: { s: number }) {
  return (
    <div className="a-drive">
      {asks.map(([ask, tool, result], i) => {
        const start = 1 + i * 3;
        const done = s >= start + 2;
        return (
          <div className="a-ex" key={tool}>
            <p className="dt-bubble dt-in" data-on={on(s, start)}>
              {ask}
            </p>
            <div className="a-call dt-in" data-on={on(s, start + 1)}>
              {done ? <Check size={12} className="a-tick" /> : <span className="dt-spin" />}
              <code>{tool}</code>
              <span className="a-call-out dt-in" data-on={done ? "" : undefined}>
                {result}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Dictate, then hear the answer, all on this computer ---- */
export const voiceLoop: Loop = {
  times: [0, 700, 1300, 2700, 3900, 4500, 5300, 6000, 8400],
  still: 7,
};
export function VoiceTile({ s }: { s: number }) {
  const listening = s >= 1 && s < 4;
  const sent = s >= 5;
  const reading = s >= 7;
  return (
    <div className="a-voice">
      <div className="a-vthread">
        <p className="dt-bubble dt-in" data-on={on(s, 5)}>
          Rename the worker, fix tests
        </p>
        <div className="a-vans dt-in" data-on={on(s, 6)}>
          <p className="dt-say">
            <Check size={12} className="a-tick" /> Renamed it to <code>queueWorker</code>. Tests pass.
          </p>
          <div className="a-vread">
            <span className="a-vbtn" data-on={reading || undefined} data-press={within(s, 6, 7)}>
              {reading ? <Square size={10} /> : <Volume2 size={13} />}
            </span>
            <span className="dt-swap a-vstate" data-on={reading ? "" : undefined}>
              <span className="dt-muted">Read aloud</span>
              <span>
                <i className="a-eq" data-on={reading || undefined}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <b key={i} className="dt-loop-eq" style={{ animationDelay: `${-i * 0.23}s` }} />
                  ))}
                </i>
                Reading with Pocket, on this computer
              </span>
            </span>
          </div>
        </div>
      </div>
      <p className="a-vlabel dt-in" data-on={listening ? "" : undefined}>
        Parakeet, on this computer · nothing leaves it
      </p>
      <div className="dt-composer a-vcomposer">
        <span className="a-vdraft">
          {sent ? (
            <Placeholder>{PLACEHOLDER.working}</Placeholder>
          ) : (
            <span className="dt-swap" data-on={s >= 2 ? "" : undefined}>
              <Placeholder>{PLACEHOLDER.idle}</Placeholder>
              <span>
                <Type text="Rename the worker" go={s >= 2} ms={900} />
                <Type text={",\u00a0fix tests"} go={s >= 3} ms={600} />
              </span>
            </span>
          )}
        </span>
        <span className="a-mic" data-live={listening || undefined}>
          <Mic size={13} />
          <i className="a-wave">
            {Array.from({ length: 7 }, (_, i) => (
              <b key={i} className="dt-loop-wave" style={{ animationDelay: `${-((i * 0.37) % 1.2)}s` }} />
            ))}
          </i>
        </span>
        <span className="dt-send" data-press={within(s, 4, 5)}>
          <ArrowUp size={13} strokeWidth={2.5} />
        </span>
      </div>
      <Cursor x={s >= 6 ? 14 : 262} y={s >= 6 ? 80 : 196} show={s >= 4 && s < 8} press={within(s, 4, 5) !== undefined || within(s, 6, 7) !== undefined} />
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
