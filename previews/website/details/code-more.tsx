// Demo tiles about your code, part two: the Git button, worktrees, drawing
// on a screenshot, tables, windows and Clip.
import {
  ArrowRight,
  Check,
  ChevronDown,
  CloudUpload,
  Copy,
  Droplet,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  PenLine,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Clip } from "../../../src/features/tips/Clip";
import "../../../src/features/tips/tips.css";
import { Cursor, Cycle, Kbd, PLACEHOLDER, Placeholder, on, within } from "./kit";
import type { Loop } from "./kit";

const is = (v: string | undefined) => v !== undefined;

/* ---- A greyed Git menu item says why ---- */
export const greyLoop: Loop = { times: [0, 900, 1500, 3000, 4300, 6400], still: 4 };
export function GreyTile({ s }: { s: number }) {
  const ready = s >= 4;
  return (
    <div className="m-grey">
      <div className="m-toolbar">
        <span className="c-branch"><FolderGit2 size={12} /> main</span>
        <span className="m-git" data-ready={ready || undefined} data-hot={within(s, 1, 5)}>
          <Cycle
            at={ready ? 1 : 0}
            items={[
              <span key="a" className="c-row"><GitBranch size={14} /> <ChevronDown size={11} /></span>,
              <span key="b" className="c-row"><GitCommitHorizontal size={13} /> Commit <ChevronDown size={12} /></span>,
            ]}
          />
        </span>
      </div>
      <div className="dt-menu m-menu" data-open={within(s, 2, 5)}>
        <div className="dt-menu-item" data-off={ready ? undefined : ""}>
          <GitCommitHorizontal size={14} /> Commit
        </div>
        <div className="dt-menu-item" data-off={ready ? undefined : ""}>
          <CloudUpload size={14} /> Commit &amp; push
        </div>
        <div className="dt-menu-item" data-off="">
          <CloudUpload size={14} /> Push
        </div>
      </div>
      <div className="m-tip dt-in" data-on={within(s, 2, 3)} style={{ top: 92 }}>Nothing to commit.</div>
      <div className="m-tip dt-in" data-on={within(s, 3, 5)} style={{ top: 148 }}>
        <Cycle at={ready ? 1 : 0} items={["Nothing to push.", "Commit the changed files first."]} />
      </div>
      <div className="dt-ui m-changes dt-in" data-on={on(s, 4)}>
        <header className="dt-muted">Changes</header>
        <span className="m-file">
          <span>src/queue.ts</span>
          <span className="c-stat"><b className="add">+12</b> <b className="del">−2</b></span>
        </span>
      </div>
      <Cursor
        x={s >= 3 ? 214 : s >= 2 ? 214 : 252}
        y={s >= 3 ? 130 : s >= 2 ? 74 : s >= 1 ? 32 : 90}
        show={s >= 1 && s < 5}
        press={false}
      />
    </div>
  );
}

/* ---- Move a thread to a worktree ---- */
export const worktreeLoop: Loop = { times: [0, 800, 2000, 2700, 3500, 6200], still: 4 };
export function WorktreeTile({ s }: { s: number }) {
  return (
    <div className="m-worktree">
      <div className="dt-swap m-wstack" data-on={on(s, 3)}>
        <div className="dt-ui c-sheet m-dialog">
          <b>Move into its own worktree?</b>
          <p>
            Every uncommitted edit in the project folder moves with the thread, onto a new branch. The project folder
            goes back to its last commit.
          </p>
          <div className="m-wfiles">
            <div className="dt-in" data-on={on(s, 1)}>
              <span>src/queue.ts</span><span className="c-stat"><b className="add">+42</b> <b className="del">−8</b></span>
            </div>
            <div className="dt-in" data-on={on(s, 1)}>
              <span>src/worker.ts</span><span className="c-stat"><b className="add">+17</b> <b className="del">−4</b></span>
              <small>also “Update the docs”</small>
            </div>
          </div>
          <footer>
            <span className="dt-btn ghost">Cancel</span>
            <span className="dt-btn primary" data-press={within(s, 2, 3)}>Move to worktree</span>
          </footer>
        </div>
        <div className="m-moved">
          <header>
            <b>Rename the sync worker</b>
            <span className="c-branch"><FolderGit2 size={12} /> relay/sync-worker</span>
          </header>
          <p className="dt-say">The agent continues the same conversation there.</p>
          <p className="dt-say dt-muted">The project folder is back at its last commit.</p>
        </div>
      </div>
      <Cursor x={s >= 2 ? 232 : 150} y={s >= 2 ? 188 : 120} show={s >= 2 && s < 3} press={is(within(s, 2, 3))} />
    </div>
  );
}

/* ---- Draw on a screenshot ---- */
export const drawLoop: Loop = { times: [0, 700, 2100, 2800, 3900, 6400, 7200], still: 5 };
export function DrawTile({ s }: { s: number }) {
  return (
    <div className="m-draw">
      <div className="m-shot">
        <div className="m-shot-bar"><i /><i /><i /></div>
        <p className="m-err">TypeError: start is not a function</p>
        <p className="m-line">at worker.ts:42</p>
        <p className="m-line m-secret">API_KEY=sk-live-4f9a81c2d7e0</p>
        <div className="m-blur dt-in" data-on={on(s, 4)} />
        <svg className="m-ink" viewBox="0 0 270 110" fill="none">
          <path
            className="m-stroke wobbly"
            data-on={within(s, 1, 2)}
            data-snap={on(s, 2)}
            pathLength="1"
            d="M18 8c40-8 150-9 190 0 12 6 8 22-6 25-40 6-150 6-184-1-14-4-10-18 0-24"
          />
          <ellipse className="m-stroke clean dt-in" data-on={on(s, 2)} cx="116" cy="20" rx="112" ry="15" />
          <path
            className="m-stroke wobbly box"
            data-on={within(s, 3, 4)}
            pathLength="1"
            d="M4 57c40-3 130-4 196 0 4 7 3 16-1 20-56 4-132 3-194 1-4-7-3-15-1-21Z"
          />
        </svg>
      </div>
      <div className="m-palette">
        <span className="m-tool" data-on={within(s, 0, 3)}><PenLine size={14} /></span>
        <span className="m-tool" data-on={on(s, 3)}><Droplet size={14} /></span>
        <i className="m-sep" />
        {["#ff3b30", "#ffd100", "#34c759", "#007aff"].map((c, i) => (
          <i className="m-dot" style={{ color: c }} data-on={i === 0 ? "" : undefined} key={c} />
        ))}
        <i className="m-sep" />
        <Check size={14} />
      </div>
      <p className="m-tips">Pause to snap a shape · Blur a box to hide all of it</p>
    </div>
  );
}

/* ---- A table that pastes into Sheets ---- */
export const tableLoop: Loop = { times: [0, 800, 1700, 2400, 3500, 6000], still: 4 };
const rows = [
  ["Model", "Speed", "Cost"],
  ["Sonnet", "Fast", "$3"],
  ["Opus", "Slow", "$15"],
];
export function TableTile({ s }: { s: number }) {
  return (
    <div className="m-table">
      <div className="dt-ui m-answer" data-hover={within(s, 1, 3)}>
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-head={i === 0 || undefined}>
                {r.map((c) => <td key={c}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="m-copy" data-on={on(s, 1)} data-done={on(s, 2)}>
          <Cycle at={s >= 2 ? 1 : 0} items={[<Copy key="a" size={13} />, <Check key="b" size={13} />]} />
        </span>
      </div>
      <ArrowRight size={14} className="m-down" />
      <div className="m-sheet">
        <div className="m-sheet-head"><i /><span>A</span><span>B</span><span>C</span></div>
        {rows.map((r, i) => (
          <div key={i} className="m-sheet-row">
            <i>{i + 1}</i>
            {r.map((c, j) => (
              <span className="dt-in" data-on={on(s, 3)} style={{ transitionDelay: `${(i * 3 + j) * 70}ms` }} key={c}>{c}</span>
            ))}
          </div>
        ))}
      </div>
      <Cursor x={s >= 2 ? 250 : 200} y={s >= 1 ? 30 : 100} show={s >= 1 && s < 3} press={is(within(s, 2, 3))} />
    </div>
  );
}

/* ---- Pop a thread into its own window ---- */
export const popLoop: Loop = { times: [0, 800, 1800, 2400, 3400, 6000], still: 4 };
export function PopTile({ s }: { s: number }) {
  return (
    <div className="m-pop">
      <div className="dt-ui m-main">
        <header>
          <b>Rename the sync worker</b>
          <span className="m-popbtn" data-hot={within(s, 1, 3)}><SquareArrowOutUpRight size={14} /></span>
        </header>
        <div className="dt-swap m-body" data-on={on(s, 3)}>
          <div>
            <p className="dt-say">Renamed the worker and moved its tests.</p>
            <p className="dt-say dt-muted">Now checking the docs for old names…</p>
          </div>
          <div className="m-elsewhere">
            <div className="m-win m-win-inline">
              <div className="m-winbar"><i /><i /><i /><span>Relay <u>/</u> <b>Rename the sync worker</b></span></div>
              <div className="m-winbody">
                <b>Working in its own window</b>
                <span className="dt-muted">Checking the docs for old names</span>
              </div>
            </div>
            <p className="m-foot"><span className="dt-link">Bring it back here</span> <Kbd>⌘⇧O</Kbd></p>
          </div>
        </div>
      </div>
      <Cursor x={s >= 1 ? 250 : 160} y={s >= 1 ? 30 : 120} show={s >= 1 && s < 3} press={is(within(s, 2, 3))} />
    </div>
  );
}

/* ---- Clip ---- */
export const clipLoop: Loop = { times: [0, 1200, 2600, 3300, 5300, 6800], still: 3 };
export function ClipTile({ s }: { s: number }) {
  const out = s >= 1 && s < 4;
  return (
    <div className="m-clip">
      <p className="dt-say">Reading the migration and the tests around it.</p>
      <div className="m-think">
        <span className="dt-spin" /> <span className="m-word">Thinking</span>
      </div>
      <div className="m-peekrow">
        <span className={`tip-peek${out ? "" : " gone"}`} data-s={s}>
          <span className="tip-say m-say">
            <span className="tip-ask">
              Select part of an answer, <span className="tip-keys">⌘L</span> quotes it in your reply
            </span>
          </span>
          <span className="tip-clip">
            <Clip up={s >= 2 && s < 4} sly={s >= 2 && s < 4} waggle={s >= 3 ? 1 : 0} />
          </span>
        </span>
      </div>
      <div className="dt-composer m-clip-composer"><Placeholder>{PLACEHOLDER.working}</Placeholder></div>
    </div>
  );
}
