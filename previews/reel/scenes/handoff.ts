import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  FilePen,
  FileText,
  LockKeyholeOpen,
  Mic,
  MonitorUp,
  PanelBottom,
  PanelLeft,
  Paperclip,
  Settings2,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import "../../../src/components/agent-trace.css";
import "../../../src/components/workspace-panes.css";
import "../../../src/components/waiting-strip.css";
import "../../../src/components/handoff.css";
import { relayMarkSvg, svgDataUrl } from "../../../src/lib/relay-icon";
import { clamp, easeOut, span } from "../math";
import { Panel } from "../stage";
import {
  badge,
  device,
  elapsed,
  glyph,
  icon,
  query,
  setClass,
  setText,
  shine,
  spin,
} from "../kit";
import { ActivityList, THREADS, type CardView, type Thread } from "./activity";

export const SOURCE = "MacBook-Pro";
export const TARGET = "Mac mini";
const TITLE = THREADS[0].title;
const REQUEST =
  "Split ProjectChat.tsx, ProjectShell.tsx and main.ts by responsibility. One file per concern, behaviour unchanged, every spec green.";
const SO_FAR = "Read 14 files, ran 6 commands, and edited 9 files";
/** How long the agent had been at it when the day's last scene opens. */
const WORKED = 2 * 3600 + 41 * 60;

/** Scene times on the source computer; the story and the score key off them. */
export const HANDOFF = {
  hover: 1.2,
  menu: 1.5,
  aim: 2.4,
  pick: 3.0,
  noted: 4.5,
  /** The bundle leaves. */
  sent: 5.2,
};

const WIDTH = 1240;
const HEIGHT = 748;

const titlebar = (mark: string) => `
  <header class="titlebar project-titlebar">
    <div class="project-titlebar-brand">
      <span class="traffic-space reel-traffic"><i></i><i></i><i></i></span>
      <button class="icon-button relay-sidebar-toggle">${icon(PanelLeft, 16)}</button>
      <img class="relay-mark" src="${mark}" width="38" height="38" alt="">
    </div>
    <div class="project-titlebar-main">
      <div class="project-window-title">
        ${badge("relay")}<span>relay</span><span class="breadcrumb-slash">/</span>
        <div class="thread-title"><strong>${TITLE}</strong></div>
      </div>
      <span class="spacer"></span>
      <div class="thread-header-actions">
        <div class="header-strip">
          <button class="pane-toggle" data-handoff>${icon(MonitorUp, 14)}</button>
          <span class="header-strip-sep" data-handoff></span>
          <div class="pane-toggles">
            <button class="pane-toggle active"><span class="pane-toggle-label">Chat</span></button>
            <button class="pane-toggle"><span class="pane-toggle-label">Files</span></button>
            <button class="pane-toggle"><span class="pane-toggle-label">History</span></button>
            <button class="pane-toggle"><span class="pane-toggle-label">Changes</span>
              <span class="pane-toggle-stat"><span class="pane-toggle-add">+1,204</span><span class="pane-toggle-del">−1,187</span></span>
            </button>
          </div>
          <span class="header-strip-sep"></span>
          <button class="pane-toggle">${icon(PanelBottom, 14)}</button>
        </div>
      </div>
    </div>
  </header>`;

const request = `
  <article class="project-message user">
    <header><strong>You</strong><time>20:24</time></header>
    <div class="markdown"><p>The big files are getting hard to review. Which are the worst?</p></div>
  </article>
  <article class="project-message assistant">
    <header><strong>${glyph("claude")}Claude</strong></header>
    <details class="agent-activity">
      <summary class="agent-run-heading">${icon(FileText, 14)}<span>Read 9 files and ran 2 commands</span><span class="agent-run-time">1m 48s</span>${icon(ChevronRight, 13, "agent-run-chevron")}</summary>
    </details>
    <div class="markdown"><p>Three stand out: <code>ProjectChat.tsx</code> at 5,212 lines, <code>ProjectShell.tsx</code> at 3,340 and <code>main.ts</code> at 2,870. Each one does four or five jobs.</p></div>
  </article>
  <article class="project-message user">
    <header><strong>You</strong><time>20:29</time></header>
    <div class="markdown"><p>${REQUEST}</p></div>
  </article>`;

/** A turn that's over, folded to its one-line summary. */
const folded = (label: string, time: string) => `
  <details class="agent-activity">
    <summary class="agent-run-heading">${icon(FilePen, 14)}<span>${label}</span><span class="agent-run-time">${time}</span>${icon(ChevronRight, 13, "agent-run-chevron")}</summary>
  </details>`;

const liveTurn = (says: string, group: string) => `
  <details class="agent-activity live" open data-live>
    <summary class="agent-run-heading">${icon(Clock3, 14)}<span>Working for</span><span class="agent-run-time" data-time></span>${icon(ChevronRight, 13, "agent-run-chevron")}</summary>
    <div class="agent-trace">
      <div class="agent-commentary"><div class="markdown"><p>${says}</p></div></div>
      <div class="agent-step agent-group"><div class="agent-step-heading">${icon(FileText, 14)}<span data-group>${group}</span></div></div>
      <div class="agent-batch running">
        <button class="agent-step-heading agent-batch-head">
          <span class="agent-batch-row"><span data-call-icon></span><span class="live-shine" data-call></span></span>
          ${icon(ChevronRight, 13, "agent-batch-chevron")}
        </button>
      </div>
    </div>
  </details>`;

const composer = `
  <form class="project-composer">
    <div class="composer-prompt-input reel-short"><p><span class="reel-placeholder" data-placeholder-text></span></p></div>
    <div class="composer-tools">
      <button class="composer-control composer-model-trigger">${glyph("claude")}<span>Fable 5.1</span>${icon(ChevronDown, 12)}</button>
      <span class="composer-divider"></span>
      <button class="composer-control">Max · 1M${icon(ChevronDown, 12)}</button>
      <span class="composer-divider"></span>
      <button class="composer-control composer-runtime">${icon(LockKeyholeOpen, 14)}Full access${icon(ChevronDown, 12)}</button>
      <span class="composer-divider"></span>
      <button class="composer-control composer-interaction">${icon(Bot, 16)}<span>Build</span>${icon(ChevronDown, 12)}</button>
      <button class="composer-control">${icon(Paperclip, 15)}</button>
      <span class="spacer"></span>
      <button class="composer-control dictation-mic">${icon(Mic, 15)}</button>
      <button class="composer-stop" data-stop><svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg></button>
      <button class="primary send-message" data-send>${icon(ArrowUp, 18)}</button>
    </div>
  </form>`;

const shell = (mark: string, messages: string, extra = "") => `
  <div class="app project-app platform-darwin">
    ${titlebar(mark)}
    <div class="project-layout">
      <aside class="projects-sidebar" data-sidebar></aside>
      <div class="project-chat-pane">
        <section class="project-chat">
          <div class="project-messages"><div class="thread-message-column reel-pinned">${messages}</div></div>
          <div class="thread-bottom-composer"><div class="thread-compose-wrap">
            <div class="waiting-strip handoff-strip" data-strip><div class="waiting-strip-head">
              <span data-strip-icon></span>
              <span class="waiting-strip-text"><b data-strip-title></b><span data-strip-detail></span></span>
              <button class="primary-action" data-bring>Bring back</button>
            </div></div>
            ${composer}
          </div></div>
        </section>
      </div>
    </div>
    ${extra}
  </div>`;

type Call = [number, LucideIcon, string];

/** The running call at time `t`, from a looping list of (duration, icon, label). */
function callAt(calls: Call[], t: number): Call {
  const total = calls.reduce((sum, c) => sum + c[0], 0);
  let k = ((t % total) + total) % total;
  for (const call of calls) {
    if (k < call[0]) return call;
    k -= call[0];
  }
  return calls[0];
}

class Desk {
  readonly panel = new Panel(WIDTH, HEIGHT, "reel-slab reel-window");
  readonly label: Panel;
  protected readonly side: ActivityList;
  private call = "";

  constructor(
    readonly computer: string,
    threads: Thread[],
    messages: string,
    extra = "",
  ) {
    const mark = svgDataUrl(relayMarkSvg("#aaa8e5"));
    this.panel.el.innerHTML = shell(mark, messages, extra);
    this.side = new ActivityList(threads);
    query(this.panel.el, "[data-sidebar]").append(this.side.el);
    this.label = new Panel(260, 34, "reel-device");
    this.label.solid = false;
    this.label.el.innerHTML = `${device(computer, 17)}<span>${computer}</span>`;
  }

  /** Stands the name tag just above the window's top-left corner. */
  tag() {
    this.label.right = this.panel.right;
    this.label.up = this.panel.up;
    this.label.scale = this.panel.scale;
    this.label.pos = this.panel.point(130, -30);
  }

  protected strip(shown: number, iconMarkup: string, title: string, detail: string, bring: boolean) {
    const el = query(this.panel.el, "[data-strip]");
    el.style.display = shown > 0.001 ? "" : "none";
    el.style.opacity = shown.toFixed(3);
    el.style.transform = `translateY(${((1 - shown) * 8).toFixed(2)}px)`;
    const holder = query(el, "[data-strip-icon]");
    if (holder.dataset.icon !== title) {
      holder.dataset.icon = title;
      holder.innerHTML = iconMarkup;
    }
    setText(query(el, "[data-strip-title]"), title);
    setText(query(el, "[data-strip-detail]"), detail ? ` · ${detail}` : "");
    query(el, "[data-bring]").style.display = bring ? "" : "none";
  }

  protected running(live: boolean, seconds: number, call: Call | null) {
    const { el } = this.panel;
    const turn = query<HTMLDetailsElement>(el, "[data-live]");
    turn.style.display = live ? "" : "none";
    setText(query(turn, "[data-time]"), elapsed(seconds));
    if (call && this.call !== call[2]) {
      this.call = call[2];
      query(turn, "[data-call-icon]").innerHTML = icon(call[1], 14);
      setText(query(turn, "[data-call]"), call[2]);
    }
    query(el, "[data-stop]").style.display = live ? "" : "none";
    query(el, "[data-send]").style.display = live ? "none" : "";
  }

  protected placeholder(text: string) {
    setText(query(this.panel.el, "[data-placeholder-text]"), text);
  }

  protected cards(views: CardView[], needing: number) {
    views.forEach((view, i) => {
      this.side.cards[i].style.opacity = this.side.paint(i, view).toFixed(2);
    });
    setText(this.side.count, String(needing));
    this.side.count.style.display = needing ? "" : "none";
  }
}

const SOURCE_CALLS: Call[] = [
  [1.1, FilePen, "Editing ProjectChat.tsx"],
  [1.6, Terminal, "Running vitest"],
  [1.3, FilePen, "Editing composer/wiring.ts"],
];

/** The computer the day was spent on. */
export class SourceDesk extends Desk {
  private readonly menu: HTMLElement;
  private readonly button: HTMLElement;
  private readonly target: HTMLElement;
  private readonly note: HTMLElement;
  private readonly noteText: HTMLElement;
  private readonly done: HTMLElement;

  constructor() {
    super(
      SOURCE,
      THREADS,
      `${request}
       <article class="project-message assistant">
         <header><strong>${glyph("claude")}Claude</strong></header>
         ${liveTurn("ProjectChat is down to 640 lines. The composer wiring moves out next.", SO_FAR)}
         <div data-done>${folded(SO_FAR, "2h 41m")}</div>
       </article>
       <div class="agent-handoff" data-note><div class="context-compaction"><span data-note-text></span><button class="text-button" data-show>Show note</button></div></div>`,
      `<div class="composer-select-popup handoff-menu reel-menu" data-menu>
         <div class="composer-menu-label">Hand off to</div>
         <div class="composer-select-item handoff-target" data-target>
           ${device(TARGET, 16)}<span class="handoff-target-text"><span>${TARGET}</span><small>Continues in relay</small></span>
         </div>
         <div class="composer-select-item handoff-target" data-disabled>
           ${device("hetzner-vps", 16)}<span class="handoff-target-text"><span>hetzner-vps</span><small>Offline</small></span>
         </div>
         <p class="handoff-menu-note">The agent stops and writes a handoff note, everything in the worktree is committed, and the thread carries on there. Ignored files such as .env stay here.</p>
         <div class="handoff-menu-separator"></div>
         <div class="composer-select-item handoff-target">${icon(Settings2, 14)}<span class="handoff-target-text"><span>Computers…</span></span></div>
       </div>`,
    );
    const { el } = this.panel;
    this.menu = query(el, "[data-menu]");
    this.button = query(el, "button[data-handoff]");
    this.target = query(el, "[data-target]");
    this.note = query(el, "[data-note]");
    this.noteText = query(el, "[data-note-text]");
    this.done = query(el, "[data-done]");
  }

  private centre?: [number, number];

  /** The hand-off button's centre, in panel pixels. Measured once, while shown. */
  buttonAt(): [number, number] {
    this.centre ??= this.panel.centre(this.button);
    return this.centre;
  }

  /**
   * `t` is scene time here; `remote` is how long the thread has been on the
   * other computer (negative until it lands), and what it's doing there.
   */
  update(t: number, remote: number, remoteCall: string) {
    const sending = t >= HANDOFF.pick;
    const away = remote >= 0;
    this.running(!sending, WORKED + Math.max(0, t), callAt(SOURCE_CALLS, t));
    this.done.style.display = sending ? "" : "none";

    setClass(this.button, "reel-hover", t >= HANDOFF.hover && !sending);
    for (const el of this.panel.el.querySelectorAll<HTMLElement>("[data-handoff]"))
      el.style.display = sending ? "none" : "";
    if (!this.menu.style.left) {
      // Under its button, like the app's own popup.
      const [x] = this.buttonAt();
      this.menu.style.left = `${Math.round(x - 14)}px`;
    }
    const open = Math.min(
      easeOut(span(t, HANDOFF.menu, HANDOFF.menu + 0.12)),
      1 - span(t, HANDOFF.pick + 0.08, HANDOFF.pick + 0.2),
    );
    this.menu.style.display = open > 0.001 ? "" : "none";
    this.menu.style.opacity = open.toFixed(3);
    this.menu.style.transform = `scale(${(0.96 + 0.04 * open).toFixed(4)})`;
    if (t >= HANDOFF.aim) this.target.setAttribute("data-highlighted", "");
    else this.target.removeAttribute("data-highlighted");
    const press = 1 - Math.abs(clamp((t - HANDOFF.pick) / 0.12, -1, 1));
    this.target.style.filter = `brightness(${(1 + 0.3 * press).toFixed(3)})`;

    this.note.style.display = sending ? "" : "none";
    this.note.style.opacity = easeOut(span(t, HANDOFF.pick + 0.2, HANDOFF.pick + 0.5)).toFixed(3);
    const noted = t >= HANDOFF.noted;
    setText(
      this.noteText,
      noted ? `Handoff note for ${TARGET}` : `Claude is writing a handoff note for ${TARGET}…`,
    );
    query(this.note, "[data-show]").style.display = noted ? "" : "none";

    const shown = easeOut(span(t, HANDOFF.pick + 0.15, HANDOFF.pick + 0.45));
    if (away)
      this.strip(shown, icon(MonitorUp, 15), `Working on ${TARGET}`, remoteCall, true);
    else
      this.strip(
        shown,
        icon(MonitorUp, 15),
        `Handing off to ${TARGET}`,
        "stopping the agent, writing the note, committing, sending…",
        false,
      );
    this.placeholder(
      away
        ? `This thread is on ${TARGET}. Bring it back to continue here.`
        : sending
          ? `Handing off to ${TARGET}…`
          : "Ask about the code, plan a change, or build something…",
    );

    this.cards(
      [
        away
          ? { mode: "running", elapsed: remote, selected: true, where: TARGET }
          : sending
            ? { mode: "running", elapsed: WORKED + t, selected: true, where: noted ? TARGET : undefined }
            : { mode: "running", elapsed: WORKED + Math.max(0, t), selected: true },
        { mode: "read", age: "3h" },
        { mode: "read", age: "5h" },
        { mode: "running", elapsed: 1930 + Math.max(0, t) },
        { mode: "read", age: "4h" },
        { mode: "read", age: "6h" },
      ],
      0,
    );
    spin(this.panel.el, t);
    shine(this.panel.el, t);
  }
}

const TARGET_THREADS: Thread[] = [
  THREADS[0],
  {
    project: "relay",
    title: "Nightly dependency bumps",
    branch: "relay/nightly-bumps",
    agents: ["codex"],
  },
  {
    project: "openusage",
    title: "Fix the flaky sidebar spec",
    branch: "main",
    agents: ["claude"],
  },
];

const TARGET_CALLS: Call[] = [
  [1.2, FileText, "Reading ProjectShell.tsx"],
  [1.3, FilePen, "Editing project-shell/Header.tsx"],
  [1.5, Terminal, "Running vitest"],
  [1.2, FilePen, "Editing project-shell/panes.ts"],
];

/** What the source's strip says the other computer is doing at `worked`. */
export const remoteCall = (worked: number) => callAt(TARGET_CALLS, worked)[2];

/** The computer that stays on. */
export class TargetDesk extends Desk {
  private readonly arrived: HTMLElement;
  private readonly answer: HTMLElement;
  private readonly finishedTurn: HTMLElement;

  constructor() {
    super(
      TARGET,
      TARGET_THREADS,
      `<div data-arrived>
         ${request}
         <article class="project-message assistant">
           <header><strong>${glyph("claude")}Claude</strong></header>
           ${folded(SO_FAR, "2h 41m")}
         </article>
         <div class="agent-handoff"><div class="context-compaction"><span>Handoff note for ${TARGET}</span><button class="text-button">Show note</button></div></div>
         <article class="project-message user">
           <header><strong>You</strong><time>23:11</time></header>
           <div class="markdown"><p>Carry on with this work, handed over from ${SOURCE}.</p></div>
         </article>
         <article class="project-message assistant">
           <header><strong>${glyph("claude")}Claude</strong></header>
           ${liveTurn("Picking up from the note. ProjectShell.tsx is next: the header, the pane wiring, then the shortcuts.", "Read 3 files")}
           <div data-finished>${folded("Read 38 files, ran 41 commands, and edited 31 files", "7h 22m")}</div>
           <div class="markdown" data-answer><p>Split into 31 modules, none over 400 lines. Tests pass.</p></div>
         </article>
       </div>`,
    );
    const { el } = this.panel;
    this.arrived = query(el, "[data-arrived]");
    this.answer = query(el, "[data-answer]");
    this.finishedTurn = query(el, "[data-finished]");
    for (const e of el.querySelectorAll<HTMLElement>("[data-handoff]")) e.style.display = "none";
  }

  /** `since` counts from the thread landing; `worked` is how long its agent has run. */
  update(since: number, worked: number, finished: boolean) {
    const landed = easeOut(span(since, 0, 0.5));
    this.arrived.style.opacity = landed.toFixed(3);
    this.arrived.style.transform = `translateY(${((1 - landed) * 14).toFixed(2)}px)`;
    this.running(since >= 0.4 && !finished, worked, callAt(TARGET_CALLS, worked));
    this.finishedTurn.style.display = finished ? "" : "none";
    this.answer.style.display = finished ? "" : "none";
    this.strip(0, "", "", "", false);
    this.placeholder(
      finished || since < 0.4
        ? "Ask about the code, plan a change, or build something…"
        : "Message Claude, its background work keeps going…",
    );
    const here: CardView =
      since < 0
        ? { mode: "read", age: "" }
        : finished
          ? { mode: "unread", age: "now", selected: true }
          : { mode: "running", elapsed: worked, selected: true };
    this.side.cards[0].style.display = since < 0 ? "none" : "";
    this.cards([here, { mode: "read", age: "3h" }, { mode: "unread", age: "1h" }], finished ? 2 : 1);
    this.side.cards[0].style.opacity = (landed * 1).toFixed(3);
    spin(this.panel.el, since);
    shine(this.panel.el, since);
  }
}
