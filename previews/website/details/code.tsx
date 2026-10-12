// Demo tiles about your code, part one: commits, rolling back, the open
// file, images, and the sync button.
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  FilePen,
  FileWarning,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  Redo2,
  Undo2,
} from "lucide-react";
import { Cursor, Cycle, Kbd, Type, on, within } from "./kit";
import type { Loop } from "./kit";

const is = (v: string | undefined) => v !== undefined;
const Stat = ({ add, del }: { add: number; del: number }) => (
  <span className="c-stat">
    <b className="add">+{add}</b> <b className="del">−{del}</b>
  </span>
);
const Box = ({ on: ticked = true }: { on?: boolean }) => (
  <i className="c-box" data-on={ticked || undefined} />
);

/* ---- Commit split ---- */
export const splitLoop: Loop = { times: [0, 1100, 1900, 2700, 3700, 4500, 5600, 7200], still: 5 };
const plan: [string, string, number, number][] = [
  ["Use the new queue in the worker", "queue.ts, worker.ts", 42, 8],
  ["Update the tests", "worker.test.ts", 31, 12],
  ["Tweak the settings copy", "settings.css", 3, 3],
];
export function SplitTile({ s }: { s: number }) {
  return (
    <div className="c-split">
      <div className="dt-ui c-sheet">
        <header>
          <b>Split into commits</b>
        </header>
        <p className="dt-muted c-plan">
          <Cycle
            at={s >= 1 ? 1 : 0}
            items={[
              <span key="a" className="c-row"><span className="dt-spin" /> Planning commits with GPT-5.5 · Medium reasoning · Standard…</span>,
              "Planned by GPT-5.5 · Medium reasoning · Standard.",
            ]}
          />
        </p>
        <div className="c-cards">
          {plan.map(([msg, files, a, d], i) => (
            <div
              className="c-commit dt-in"
              data-on={on(s, i + 1)}
              data-dim={i === 2 && s >= 4 ? "" : undefined}
              key={msg}
            >
              <Box on={!(i === 2 && s >= 4)} />
              <div>
                <p>{msg}</p>
                <small>{files} <Stat add={a} del={d} /></small>
              </div>
            </div>
          ))}
        </div>
        <footer>
          <span className="dt-btn ghost">Plan again</span>
          <span className="dt-btn primary" data-press={within(s, 5, 6)}>
            <Cycle at={s >= 6 ? 1 : 0} items={["Commit 2", "Committing…"]} />
          </span>
        </footer>
      </div>
      <Cursor x={s >= 5 ? 238 : s >= 4 ? 28 : 150} y={s >= 5 ? 196 : s >= 4 ? 164 : 120} show={s >= 4 && s < 7} press={is(within(s, 4, 5)) || is(within(s, 5, 6))} />
    </div>
  );
}

/* ---- Commit message ---- */
export const messageLoop: Loop = { times: [0, 700, 1500, 3300, 4300, 6400], still: 4 };
const files = ["src/queue.ts", "src/worker.ts", "src/worker.test.ts"];
export function MessageTile({ s }: { s: number }) {
  return (
    <div className="c-message">
      <div className="dt-ui c-sheet">
        <header>
          <b>Commit &amp; push</b>
          <span className="c-route dt-muted">
            feat/sync <ArrowRight size={11} /> origin
          </span>
        </header>
        <div className="c-label">
          <span>Message</span>
          <RefreshCw size={12} className="dt-muted" />
        </div>
        <div className="c-textarea">
          <span className="dt-swap" data-on={on(s, 1)}>
            <span className="c-row dt-muted"><span className="dt-spin" /> Writing a message…</span>
            <span className="c-subject">
              <Type text="Move the sync worker onto the new queue" go={s >= 2} ms={1500} />
            </span>
          </span>
          <small className="c-count dt-in" data-on={on(s, 3)}>39/72</small>
        </div>
        <div className="c-files">
          {files.map((f) => (
            <div key={f}>
              <Box />
              <span>{f}</span>
            </div>
          ))}
        </div>
        <footer>
          <span className="dt-btn primary" data-press={within(s, 4, 5)}>
            Commit 3 of 5 files &amp; push <Kbd>⌘↵</Kbd>
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ---- Roll back one turn, redo ---- */
export const rollbackLoop: Loop = { times: [0, 900, 1700, 3000, 3800, 5400, 7000], still: 5 };
const changed: [string, number, number][] = [
  ["src/queue.ts", 42, 8],
  ["src/worker.ts", 17, 4],
  ["src/worker.test.ts", 31, 12],
];
export function RollbackTile({ s }: { s: number }) {
  const back = s >= 2 && s < 4;
  return (
    <div className="c-rollback">
      <div className="dt-ui c-sheet c-changed">
        <header>
          <b>3 changed files</b>
          <span className="dt-muted c-note dt-in" data-on={back ? "" : undefined}>1 rolled back</span>
          <span className="dt-btn ghost">Roll back</span>
        </header>
        {changed.map(([f, a, d], i) => (
          <div className="c-file" data-hover={i === 1 ? within(s, 1, 5) : undefined} data-back={i === 1 && back ? "" : undefined} key={f}>
            <span className="c-fname">{f}</span>
            <Stat add={a} del={d} />
            <span className="c-undo" data-hot={i === 1 ? within(s, 2, 3) ?? within(s, 4, 5) : undefined}>
              {i === 1 && back ? <Redo2 size={13} /> : <Undo2 size={13} />}
            </span>
          </div>
        ))}
        <p className="c-tip dt-in" data-on={within(s, 2, 3)}>Roll back this file to before this turn</p>
      </div>
      <Cursor x={s >= 4 ? 262 : s >= 1 ? 262 : 150} y={s >= 1 ? 84 : 140} show={s >= 1 && s < 6} press={is(within(s, 2, 3)) || is(within(s, 4, 5))} />
    </div>
  );
}

/* ---- The open file follows the agent ---- */
export const refreshLoop: Loop = { times: [0, 1000, 2300, 3500, 5800], still: 3 };
const code: [string, string][] = [
  ["const queue = new Queue();", "const queue = new Queue({ retries: 3 });"],
  ["worker.on(\"job\", run);", "worker.on(\"job\", withBackoff(run));"],
  ["await queue.start();", "await queue.start();"],
];
export function RefreshTile({ s }: { s: number }) {
  return (
    <div className="c-refresh">
      <div className="c-agentrow">
        <Cycle
          at={s >= 3 ? 1 : 0}
          items={[
            <span key="a" className="c-row"><span className="dt-spin" /> Editing sync.ts</span>,
            <span key="b" className="c-row"><FilePen size={12} /> Edited sync.ts</span>,
          ]}
        />
      </div>
      <div className="dt-ui c-editor">
        <div className="c-tab">sync.ts</div>
        <div className="c-code">
          {code.map(([before, after], i) => (
            <div className="c-line" data-new={i < 2 && s >= 2 ? "" : undefined} key={i}>
              <span className="c-ln">{i + 1}</span>
              <Cycle at={i < 2 && s >= 2 ? 1 : 0} items={[before, after]} />
            </div>
          ))}
        </div>
        <div className="c-editor-foot dt-muted">Local working tree · editable</div>
      </div>
    </div>
  );
}

/* ---- Image diff ---- */
export const imageLoop: Loop = { times: [0, 900, 2000, 3400, 5600], still: 3 };
function Shot({ after }: { after?: boolean }) {
  return (
    <div className="c-shot" data-after={after || undefined}>
      <span className="c-shot-bar" />
      <span className="c-shot-line" />
      <span className="c-shot-line short" />
      <span className="c-shot-btn" />
    </div>
  );
}
export function ImageTile({ s }: { s: number }) {
  return (
    <div className="c-image">
      <div className="c-pair">
        <figure>
          <div className="c-checker"><Shot /></div>
          <figcaption>Before <small>1280 × 720</small></figcaption>
        </figure>
        <figure>
          <div className="c-checker">
            <div className="dt-in" data-on={on(s, 1)} style={{ height: "100%" }}><Shot after /></div>
          </div>
          <figcaption className="dt-in" data-on={on(s, 1)}>After <small>1280 × 720</small></figcaption>
        </figure>
        <i className="c-ring l dt-in" data-on={on(s, 2)} />
        <i className="c-ring r dt-in" data-on={on(s, 2)} />
      </div>
    </div>
  );
}

/* ---- Sync, rebase, conflict ---- */
export const syncLoop: Loop = { times: [0, 900, 1600, 3000, 4000, 4900, 6900], still: 4 };
export function SyncTile({ s }: { s: number }) {
  return (
    <div className="c-sync">
      <div className="c-bar">
        <span className="c-branch"><GitBranch size={12} /> feat/sync</span>
        <span className="c-chip" data-hot={within(s, 1, 2)} data-warn={on(s, 2)}>
          <Cycle
            at={s >= 3 ? 2 : s >= 2 ? 1 : 0}
            items={[
              <span key="a" className="c-row"><ArrowDown size={12} /> 2 <ArrowUp size={12} /> 1</span>,
              <span key="b" className="c-row"><span className="dt-spin" /></span>,
              <span key="c" className="c-row"><CircleAlert size={12} /> ↓2 ↑1</span>,
            ]}
          />
        </span>
      </div>
      <div className="dt-swap c-slot" data-on={on(s, 5)}>
        <div className="dt-ui c-conflict dt-in" data-on={on(s, 3)}>
          <header><CircleAlert size={14} /> <b>Couldn’t rebase onto origin/main</b></header>
          <p>Both sides changed the same lines. The rebase was undone, so nothing in the project folder moved.</p>
          <div className="c-conf"><FileWarning size={12} /> src/queue.ts</div>
          <footer>
            <span className="dt-btn ghost">Open as draft</span>
            <span className="dt-btn primary" data-press={within(s, 4, 5)}>Resolve in new thread</span>
          </footer>
        </div>
        <div className="dt-card c-newthread">
          <div className="dt-card-top">
            <span className="dt-badge">R</span>
            <span className="dt-card-project">Relay</span>
            <span className="dt-card-state" data-kind="working"><i /> Working</span>
          </div>
          <span className="dt-card-title">Rebase feat/sync onto origin/main</span>
          <div className="dt-card-meta"><GitPullRequest size={11} /> Resolving conflicts in src/queue.ts</div>
        </div>
      </div>
      <Cursor x={s >= 4 ? 222 : 214} y={s >= 4 ? 190 : 14} show={s >= 1 && s < 5 && true} press={is(within(s, 1, 2)) || is(within(s, 4, 5))} />
    </div>
  );
}
