import {
  ChevronRight,
  FolderGit2,
  GitPullRequest,
  GitPullRequestDraft,
  Link2,
  RefreshCw,
  Search,
} from "lucide-react";
import "../../../src/components/pull-requests.css";
import "../../../src/components/ci-status.css";
import { easeOut, settle, span } from "../math";
import { Panel } from "../stage";
import { badge, icon, person, query, setClass, setText } from "../kit";

interface Tile {
  project: string;
  repo: string;
  number: number;
  title: string;
  reason: string;
  alarm?: boolean;
  author: string;
  age: string;
}

const TILES: Tile[] = [
  {
    project: "Portal",
    repo: "web/portal",
    number: 231,
    title: "Move invoice export to a background job",
    reason: "Review requested",
    author: "anna",
    age: "2h",
  },
  {
    project: "Relay",
    repo: "relay/relay",
    number: 418,
    title: "Phone: reconnect the bridge after sleep",
    reason: "Review started",
    author: "tomas",
    age: "5h",
  },
  {
    project: "Licensing",
    repo: "web/licensing",
    number: 4,
    title: "License search: server-side search and an All Licenses page",
    reason: "Changes requested",
    alarm: true,
    author: "you",
    age: "1d",
  },
];

/** The verdict that arrives mid-scene: your own PR, approved. */
const APPROVED: Tile = {
  project: "Relay",
  repo: "relay/relay",
  number: 427,
  title: "Deep review with a council of agents",
  reason: "Ready to merge",
  author: "you",
  age: "now",
};

type Glyph = "open" | "draft";
interface Card {
  name: string;
  repo: string;
  count: string;
  mine?: string;
  remote?: boolean;
  rows: [Glyph, string, string, boolean?][];
  more?: string;
}

const CARDS: Card[] = [
  {
    name: "Relay",
    repo: "relay/relay",
    count: "5 PRs",
    mine: "1 for you",
    rows: [
      ["open", "Phone: reconnect the bridge after sleep", "5h", true],
      ["open", "Deep review with a council of agents", "12m"],
      ["draft", "Quick switch between model presets", "1d"],
      ["open", "Share snapshots without Gitea", "2d"],
    ],
    more: "All 5",
  },
  {
    name: "Portal",
    repo: "web/portal",
    count: "3 PRs",
    mine: "1 for you",
    rows: [
      ["open", "Move invoice export to a background job", "2h", true],
      ["open", "Upgrade Angular and Material to 22", "1d"],
      ["open", "Cookie banner copy for DE and AT", "3d"],
    ],
  },
  {
    name: "Licensing",
    repo: "web/licensing",
    count: "3 PRs",
    mine: "1 for you",
    rows: [
      ["open", "License search: server-side search and an All Licenses page", "1d", true],
      ["open", "Seat limits per site", "4h"],
      ["draft", "Audit log for license changes", "5d"],
    ],
  },
  {
    name: "OpenUsage",
    repo: "tools/openusage",
    count: "2 PRs",
    rows: [
      ["open", "Usage history export to CSV", "3h"],
      ["open", "Fix tray icon on Linux", "6d"],
    ],
  },
  {
    name: "infra/deploy",
    repo: "Not on this Mac",
    count: "2 PRs",
    remote: true,
    rows: [
      ["open", "Pin the runner image and cache node_modules", "1d"],
      ["open", "Staging: separate Redis instance", "4d"],
    ],
  },
];

/** Scene times the story and the score key off. */
export const PULLS = { approved: 3.6 };

const tile = (t: Tile, extra = "") => `
  <button class="pulls-tile" ${extra}>
    <span class="pulls-repo quiet">
      ${badge(t.project.toLowerCase())}
      <span class="pulls-repo-name">${t.repo}</span><span class="pulls-num">#${t.number}</span>
    </span>
    <span class="pulls-tile-title">${t.title}</span>
    <span class="pulls-tile-reason ${t.alarm ? "alarm" : ""}">${t.reason}</span>
    <span class="pulls-tile-foot">
      ${person(t.author)}<span class="pulls-tile-author">${t.author}</span><span class="pulls-time">${t.age}</span>
    </span>
  </button>`;

const card = (c: Card, index: number) => `
  <article class="pulls-card ${c.remote ? "remote" : ""}" data-card="${index}">
    <button class="pulls-card-head">
      ${c.remote ? `<span class="pulls-remote-mark">${icon(FolderGit2, 10)}</span>` : badge(c.name.toLowerCase())}
      <span class="pulls-card-name"><strong>${c.name}</strong><small>${c.repo}</small></span>
      <span class="pulls-card-count"><span>${c.count}</span>${c.mine ? `<em data-mine>${c.mine}</em>` : ""}</span>
    </button>
    <div class="pulls-card-rows">
      ${c.rows
        .map(
          ([kind, title, age, needs]) => `
        <button class="pulls-card-row ${needs ? "needs" : ""}">
          ${icon(kind === "draft" ? GitPullRequestDraft : GitPullRequest, 13, `pulls-glyph ${kind}`)}
          <span class="pulls-card-title">${title}</span><span class="pulls-time">${age}</span>
        </button>`,
        )
        .join("")}
    </div>
    ${c.more ? `<button class="pulls-card-more">${c.more}${icon(ChevronRight, 12)}</button>` : ""}
  </article>`;

export class Pulls {
  readonly panel = new Panel(1100, 700, "reel-slab");
  private readonly need: HTMLElement;
  private readonly needCount: HTMLElement;
  private readonly tiles: HTMLElement[];
  private readonly arriving: HTMLElement;
  private readonly cards: HTMLElement[];
  private readonly refresh: HTMLElement;
  private readonly approvedRow: HTMLElement;
  private readonly approvedAge: HTMLElement;
  private readonly mine: HTMLElement;

  constructor() {
    this.panel.el.innerHTML = `
      <div class="pulls-page">
        <header class="pulls-head">
          <div class="pulls-head-text">
            <h1>Pull requests</h1>
            <p><strong data-need></strong> · 14 open in 5 repositories</p>
          </div>
          <div class="pulls-tools">
            <label class="pulls-search">${icon(Search, 13)}<input placeholder="Search pull requests" tabindex="-1" readonly><kbd>⌘F</kbd></label>
            <div class="pulls-states">
              <button aria-checked="true">Open</button><button>Closed</button><button>All</button>
            </div>
            <button class="pulls-quiet-button">${icon(Link2, 14)}Open by URL</button>
            <button class="pulls-icon-button"><span data-refresh>${icon(RefreshCw, 14)}</span></button>
          </div>
        </header>
        <section class="pulls-section">
          <h2>Needs you<small data-need-count></small></h2>
          <div class="pulls-tiles">${TILES.map((t) => tile(t)).join("")}${tile(APPROVED, "data-arriving")}</div>
        </section>
        <section class="pulls-section">
          <h2>Projects<small>5</small></h2>
          <div class="pulls-cards">${CARDS.map(card).join("")}</div>
        </section>
      </div>`;
    const { el } = this.panel;
    this.need = query(el, "[data-need]");
    this.needCount = query(el, "[data-need-count]");
    this.tiles = [...el.querySelectorAll<HTMLElement>(".pulls-tile:not([data-arriving])")];
    this.arriving = query(el, "[data-arriving]");
    this.cards = [...el.querySelectorAll<HTMLElement>(".pulls-card")];
    this.refresh = query(el, "[data-refresh]");
    this.approvedRow = this.cards[0].querySelectorAll<HTMLElement>(".pulls-card-row")[1];
    this.approvedAge = query(this.approvedRow, ".pulls-time");
    this.mine = query(this.cards[0], "[data-mine]");
  }

  update(t: number) {
    const approved = t >= PULLS.approved;
    const count = TILES.length + (approved ? 1 : 0);
    setText(this.need, `${count} need you`);
    setText(this.needCount, String(count));
    this.tiles.forEach((el, i) => {
      const enter = easeOut(span(t, 0.35 + i * 0.1, 0.8 + i * 0.1));
      el.style.opacity = enter.toFixed(3);
      el.style.transform = `translateY(${((1 - enter) * 8).toFixed(2)}px)`;
    });
    const land = settle(span(t, PULLS.approved, PULLS.approved + 0.45), 1.8);
    this.arriving.style.opacity = span(t, PULLS.approved, PULLS.approved + 0.18).toFixed(3);
    this.arriving.style.transform = `scale(${(0.9 + 0.1 * land).toFixed(4)})`;
    this.cards.forEach((el, i) => {
      const enter = easeOut(span(t, 0.7 + i * 0.12, 1.2 + i * 0.12));
      el.style.opacity = enter.toFixed(3);
      el.style.transform = `translateY(${((1 - enter) * 10).toFixed(2)}px)`;
    });
    setClass(this.approvedRow, "needs", approved);
    setText(this.approvedAge, approved ? "now" : "12m");
    setText(this.mine, approved ? "2 for you" : "1 for you");
    // The refresh icon turns while the verdict is on its way.
    const turning = span(t, 0.2, PULLS.approved);
    this.refresh.style.display = "inline-flex";
    this.refresh.style.transform = `rotate(${(turning < 1 ? (t / 1.2) * 360 : 0).toFixed(1)}deg)`;
  }
}
