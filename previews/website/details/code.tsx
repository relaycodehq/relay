// Demo tiles about your code, part one: rolling back and the sync button.
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  FileWarning,
  GitBranch,
  GitPullRequest,
  Redo2,
  Undo2,
} from "lucide-react";
import { Cursor, Cycle, on, within } from "./kit";
import type { Loop } from "./kit";

const is = (v: string | undefined) => v !== undefined;
const Stat = ({ add, del }: { add: number; del: number }) => (
  <span className="c-stat">
    <b className="add">+{add}</b> <b className="del">−{del}</b>
  </span>
);
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
