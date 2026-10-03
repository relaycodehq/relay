import {
  Bell,
  ChevronRight,
  GitPullRequest,
  MonitorUp,
  Plus,
  Search,
} from "lucide-react";
import "../../../../src/app/projects.css";
import "../../../../src/features/sidebar/sidebar.css";
import { clamp, easeOut, settle, span } from "../math";
import { Panel } from "../stage";
import {
  badge,
  elapsed,
  glyph,
  icon,
  query,
  setClass,
  setText,
  spin,
  spinner,
  type Agent,
} from "../kit";

export interface Thread {
  project: string;
  title: string;
  branch: string;
  agents: Agent[];
  pr?: number;
}

export type CardMode = "waiting" | "running" | "unread" | "read";

export interface CardView {
  mode: CardMode;
  /** Seconds the turn has run, for a running card. */
  elapsed?: number;
  /** What a quiet or unread card shows instead of a state: 20m, now. */
  age?: string;
  selected?: boolean;
  /** The computer the thread was handed to, when it's away. */
  where?: string;
}

const card = (thread: Thread, index: number) => `
  <div class="sb-card" data-card="${index}">
    <div class="sb-card-top">
      ${badge(thread.project)}
      <span class="sb-card-name">
        <span class="sb-card-project">${thread.project}</span>
        <kbd class="sb-card-shortcut"><span class="glyph">⌘</span>${index + 1}</kbd>
      </span>
      <span class="sb-card-state" data-state></span>
    </div>
    <span class="sb-card-title">${thread.title}</span>
    <div class="sb-card-meta">
      ${thread.pr ? `<span class="sb-card-scope">${icon(GitPullRequest, 11)}#${thread.pr}</span>` : ""}
      <span class="sb-card-branch">${thread.branch}</span>
      <span class="sb-card-where" data-where>${icon(MonitorUp, 11)}<span></span></span>
      <span class="sb-card-provider">${thread.agents.map(glyph).join("")}</span>
    </div>
  </div>`;

const shelf = (name: string, count: number) => `
  <section class="sb-shelf">
    <button class="sb-shelf-toggle"><span>${name} <b>${count}</b></span><hr>${icon(ChevronRight, 12)}</button>
  </section>`;

/** The sidebar's Activity view: the app's own markup, painted by the film. */
export class ActivityList {
  readonly el = document.createElement("div");
  readonly cards: HTMLElement[];
  readonly count: HTMLElement;
  readonly list: HTMLElement;
  private readonly states: HTMLElement[];
  private readonly modes: string[] = [];

  constructor(threads: Thread[]) {
    this.el.className = "sb";
    this.el.innerHTML = `
      <div class="sb-top">
        <label class="sb-search">${icon(Search, 13)}<input placeholder="Search" tabindex="-1" readonly></label>
        <button class="sb-top-button">${icon(Plus, 16)}</button>
        <button class="sb-top-button sb-bell active">${icon(Bell, 15)}<span class="sb-bell-count"></span></button>
      </div>
      <div class="sb-scroll sb-activity">
        <div class="sb-view-heading"><h2>Activity</h2><small>${threads.length} open</small></div>
        <div class="sb-cards">${threads.map(card).join("")}</div>
        ${shelf("Snoozed", 2)}${shelf("Settled", 15)}
      </div>`;
    this.cards = [...this.el.querySelectorAll<HTMLElement>(".sb-card")];
    this.states = this.cards.map((c) => query(c, "[data-state]"));
    this.count = query(this.el, ".sb-bell-count");
    this.list = query(this.el, ".sb-cards");
    for (const c of this.cards) query(c, ".sb-card-shortcut").style.display = "none";
  }

  /** Paints one card; returns how bright the app would show it. */
  paint(index: number, view: CardView): number {
    const el = this.cards[index];
    const state = this.states[index];
    if (this.modes[index] !== view.mode) {
      this.modes[index] = view.mode;
      state.className = `sb-card-state ${view.mode === "read" ? "" : view.mode}`;
      state.innerHTML =
        view.mode === "waiting"
          ? "<i></i>Needs input"
          : view.mode === "running"
            ? `${spinner(11)}Working<span class="sb-elapsed"></span>`
            : view.mode === "unread"
              ? `<i></i><span data-age></span>`
              : `<span data-age></span>`;
    }
    if (view.mode === "running")
      setText(query(state, ".sb-elapsed"), elapsed(view.elapsed ?? 0));
    else if (view.mode !== "waiting")
      setText(query(state, "[data-age]"), view.age ?? "");
    setClass(el, "selected", !!view.selected);
    const where = query(el, "[data-where]");
    where.style.display = view.where ? "" : "none";
    if (view.where) setText(where.lastElementChild as HTMLElement, view.where);
    // The app dims whatever doesn't need you: quiet threads and busy ones.
    return view.selected || view.mode === "unread" || view.mode === "waiting"
      ? 1
      : 0.45;
  }
}

interface Scripted extends Thread {
  /** Seconds the turn had already run when the scene opens. */
  running?: number;
  waiting?: boolean;
  /** Scene time at which a running turn finishes and the card goes unread. */
  finishes?: number;
  unread?: boolean;
  age?: string;
}

/** The hero is first: its lane is the ribbon the film follows out of here. */
export const THREADS: Scripted[] = [
  {
    project: "relay",
    title: "Split the 5k-line god files",
    branch: "relay/split-the-god-files",
    agents: ["claude"],
    running: 724,
  },
  {
    project: "relay",
    title: "Rebase button for diverged branches",
    branch: "relay/diverged-rebase",
    agents: ["codex"],
    waiting: true,
  },
  {
    project: "openusage",
    title: "Usage history export to CSV",
    branch: "main",
    agents: ["claude", "codex"],
    running: 221,
    finishes: 4.6,
  },
  {
    project: "portal",
    title: "Upgrade Angular and Material to 22",
    branch: "portal/material-22",
    agents: ["opencode"],
    running: 48,
  },
  {
    project: "relay",
    title: "Review #418 · Phone reconnect",
    branch: "phone-reconnect",
    agents: ["cursor"],
    pr: 418,
    age: "20m",
  },
  {
    project: "licensing",
    title: "Seat limits per site",
    branch: "licensing/seat-limits",
    agents: ["claude"],
    unread: true,
    age: "4m",
  },
];

/** Scene times the story and the score key off. */
export const ACTIVITY = {
  held: [6.3, 8.5] as const,
  picked: 7.5,
  finished: 4.6,
};

const WIDTH = 300;
const HEIGHT = 612;

export class Activity {
  readonly panel = new Panel(WIDTH, HEIGHT, "reel-slab reel-sidebar");
  private readonly view = new ActivityList(THREADS);

  constructor() {
    this.panel.el.append(this.view.el);
  }

  /** Where card `index` meets the panel's right edge, in panel pixels. */
  lane(index: number): [number, number] {
    return [WIDTH, this.panel.centre(this.view.cards[index])[1]];
  }

  update(t: number) {
    const { view } = this;
    const [from, to] = ACTIVITY.held;
    const held = t >= from && t < to;
    setClass(view.list, "shortcuts", held);
    let needing = 0;
    THREADS.forEach((thread, i) => {
      const el = view.cards[i];
      const finished = thread.finishes !== undefined && t >= thread.finishes;
      const running = thread.running !== undefined && !finished;
      const unread = thread.unread || finished;
      const selected = i === 0 && t >= ACTIVITY.picked;
      if (unread || thread.waiting) needing++;
      const bright = view.paint(i, {
        mode: thread.waiting ? "waiting" : running ? "running" : unread ? "unread" : "read",
        elapsed: (thread.running ?? 0) + Math.max(0, t),
        age: finished ? "now" : thread.age,
        selected,
      });
      // Lighting up takes a moment, as the app's own opacity transition does.
      const since = finished ? thread.finishes! : selected ? ACTIVITY.picked : -10;
      const brightness = 0.45 + (bright - 0.45) * easeOut(span(t, since, since + 0.3));
      const enter = easeOut(span(t, -0.7 + i * 0.1, -0.2 + i * 0.1));
      el.style.opacity = (enter * brightness).toFixed(3);
      el.style.transform = `translateY(${((1 - enter) * 6).toFixed(2)}px)`;

      const chip = query(el, ".sb-card-shortcut");
      const shown = easeOut(span(t, from + i * 0.05, from + 0.12 + i * 0.05));
      chip.style.display = held ? "" : "none";
      chip.style.opacity = shown.toFixed(3);
      chip.style.transform = `translateY(${((1 - shown) * 3).toFixed(2)}px)`;
    });

    setText(view.count, String(needing));
    const pop =
      t < ACTIVITY.finished
        ? 1
        : settle(span(t, ACTIVITY.finished, ACTIVITY.finished + 0.3), 2.4);
    view.count.style.transform = `scale(${clamp(pop, 0.4, 1.4).toFixed(3)})`;
    spin(this.panel.el, t);
  }
}
