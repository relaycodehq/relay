import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileCode,
  FileText,
  ScanSearch,
  Search,
  Telescope,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import "../../../src/components/deep-review.css";
import "../../../src/components/changed-files.css";
import { clamp, easeOut, span } from "../math";
import { Panel } from "../stage";
import {
  glyph,
  icon,
  query,
  setClass,
  setText,
  shine,
  typed,
  type Agent,
} from "../kit";

type Call = "command" | "read" | "search";

interface Reviewer {
  agent: Agent;
  name: string;
  model: string;
  effort: string;
  /** What Deep review asked this agent, in its own review command where it has one. */
  prompt: string;
  /** Scene time of each call, what kind it is, and its label live and done. */
  calls: [number, Call, string, string][];
  /** When the answer starts streaming, and when the reviewer is done. */
  answers: number;
  done: number;
  answer: string;
  tokens: number;
}

export const REVIEWERS: Reviewer[] = [
  {
    agent: "claude",
    name: "Claude",
    model: "Opus 5.5",
    effort: "High",
    prompt: "/code-review",
    calls: [
      [0.9, "command", "Running git", "git diff --stat HEAD"],
      [1.5, "read", "Reading ProjectChat.tsx", "src/components/ProjectChat.tsx"],
      [2.3, "search", "Searching for setQueryData", "setQueryData"],
      [2.9, "read", "Reading ProjectShell.tsx", "src/components/ProjectShell.tsx"],
    ],
    answers: 3.5,
    done: 4.3,
    answer: "Found 3 issues in the uncommitted changes.",
    tokens: 48,
  },
  {
    agent: "codex",
    name: "Codex",
    model: "GPT-6-Sol",
    effort: "High",
    prompt: "/review",
    calls: [
      [1.0, "command", "Running git", "/bin/zsh -lc 'git diff --stat'"],
      [1.8, "read", "Reading ProjectChat.tsx", "src/components/ProjectChat.tsx"],
      [2.7, "read", "Reading PastedTextCard.tsx", "src/components/PastedTextCard.tsx"],
      [3.6, "command", "Running vitest", "npx vitest run tests/unit/queue-reorder.test.ts"],
    ],
    answers: 4.3,
    done: 5.0,
    answer: "[P1] Queue reorder can drop a message.",
    tokens: 61,
  },
  {
    agent: "opencode",
    name: "OpenCode",
    model: "Kimi K2",
    effort: "Default",
    prompt: "Review the uncommitted changes for bugs.",
    calls: [
      [1.2, "read", "Reading ModelField.tsx", "src/components/ModelField.tsx"],
      [2.1, "search", "Searching for staleTime", "staleTime"],
      [3.0, "read", "Reading ProjectComposer.tsx", "src/components/ProjectComposer.tsx"],
    ],
    answers: 3.9,
    done: 4.6,
    answer: "One model list is cached two ways.",
    tokens: 29,
  },
  {
    agent: "cursor",
    name: "Cursor",
    model: "Composer 2.5",
    effort: "Default",
    prompt: "/review-bugbot",
    calls: [
      [1.1, "read", "Reading waiting-strip.css", "src/components/waiting-strip.css"],
      [2.0, "search", "Searching for data-inactive", "data-inactive"],
      [2.8, "read", "Reading styles.css", "src/styles.css"],
      [3.9, "read", "Reading ProjectChat.tsx", "src/components/ProjectChat.tsx"],
    ],
    answers: 4.8,
    done: 5.5,
    answer: "The new strip isn’t in the pause list.",
    tokens: 37,
  },
];

interface Finding {
  priority: "P1" | "P2" | "P3";
  title: string;
  file: string;
  line: number;
  dir: string;
  /** Which reviewers raised it. */
  by: number[];
}

const FINDINGS: Finding[] = [
  {
    priority: "P1",
    title: "Reordering the queue can drop a message",
    file: "ProjectChat.tsx",
    line: 895,
    dir: "src/components",
    by: [0, 1, 3],
  },
  {
    priority: "P1",
    title: "Thread keeps its PR scope after switching branch",
    file: "ProjectShell.tsx",
    line: 199,
    dir: "src/components",
    by: [0],
  },
  {
    priority: "P2",
    title: "Waiting strip keeps animating when the window is unfocused",
    file: "waiting-strip.css",
    line: 12,
    dir: "src/components",
    by: [0, 3],
  },
  {
    priority: "P2",
    title: "A pasted text card disappears on reload",
    file: "PastedTextCard.tsx",
    line: 48,
    dir: "src/components",
    by: [1],
  },
  {
    priority: "P3",
    title: "Two cache lifetimes for one Claude model list",
    file: "ModelField.tsx",
    line: 45,
    dir: "src/components",
    by: [2],
  },
];

const callIcons: Record<Call, LucideIcon> = {
  command: Terminal,
  read: FileText,
  search: Search,
};

/** Scene times the story and the score key off. */
export const REVIEW = {
  council: 0.5,
  handover: 5.9,
  report: 6.7,
  fix: 9.5,
  fixed: (index: number) => 10.1 + index * 0.3,
  leave: 12.4,
};

const tag = (priority: string) =>
  `<button class="deep-review-priority" data-priority="${priority}">${priority}</button>`;

/** The lead's summary: plain runs and the priority tags that sit in them. */
const SUMMARY: string[] = [
  "Two things need fixing before this ships. Reordering the queue can drop a message when two moves land close together",
  tag("P1"),
  ", and a thread keeps its PR scope after you switch branch",
  tag("P1"),
  ". Three smaller ones are below.",
];

const chip = (r: { agent: Agent; model: string; effort: string }) =>
  `<span class="deep-review-agent">${glyph(r.agent)}${r.model}<span class="muted">${r.effort}</span></span>`;

const pane = (r: Reviewer, index: number) => `
  <section class="deep-review-pane" data-pane="${index}">
    <header>
      ${glyph(r.agent)}<strong>${r.model}</strong><span class="muted">${r.effort}</span>
      <span class="spacer"></span>
      <span class="deep-review-pane-tokens" data-tokens></span>
      <span class="deep-review-pane-status done" data-done>${icon(CircleCheck, 13)} Done</span>
    </header>
    <div class="deep-review-pane-thread reel-pane-thread">
      <article class="project-message user">
        <header><strong>You</strong><span class="muted">via Deep review</span></header>
        <div class="markdown deep-review-pane-prompt"><p>${r.prompt}</p></div>
      </article>
      <article class="project-message assistant" data-reply>
        <header><strong>${glyph(r.agent)}${r.name}</strong></header>
      <div class="agent-activity reel-pane-rows">
        ${r.calls
          .map(
            ([, kind, live, done], i) => `
          <div class="agent-step complete" data-call="${i}">
            <div class="agent-step-heading">${icon(callIcons[kind], 14)}
              <span class="${kind === "read" ? "" : "mono"}" data-done-label>${done}</span>
              <span class="live-shine" data-live-label>${live}</span>
            </div>
          </div>`,
          )
          .join("")}
        <div class="markdown reel-pane-answer"><p data-answer></p></div>
      </div>
      </article>
    </div>
  </section>`;

const finding = (f: Finding, index: number) => `
  <li class="deep-review-task" data-status="open" data-finding="${index}">
    <label class="deep-review-task-head">
      <span class="reel-check">
        <input type="checkbox" tabindex="-1" ${f.priority === "P1" ? "checked" : ""}>
        ${icon(CircleCheck, 15, "deep-review-task-fixed")}
      </span>
      <span class="deep-review-priority" data-priority="${f.priority}">${f.priority}</span>
      <span class="deep-review-task-title">${f.title}</span>
      <span class="deep-review-status" data-fixing>Fixing…</span>
      <span class="deep-review-found-by">${f.by.map((r) => glyph(REVIEWERS[r].agent)).join("")}${f.by.length}/${REVIEWERS.length}</span>
    </label>
    <ul class="deep-review-task-files"><li>
      <button class="deep-review-task-file">
        ${icon(FileCode, 13)}<span class="deep-review-task-file-name">${f.file}</span>
        <span class="deep-review-task-file-line">L${f.line}</span>
        <span class="deep-review-task-file-dir">${f.dir}</span>
      </button>
    </li></ul>
  </li>`;

const councilGlyphs = `<span class="deep-review-council-glyphs">${REVIEWERS.map((r) => glyph(r.agent)).join("")}</span>`;

export class Review {
  readonly panel = new Panel(940, 776, "reel-slab reel-thread");
  private readonly council: HTMLElement;
  private readonly report: HTMLElement;
  private readonly handover: HTMLElement;
  private readonly panes: HTMLElement[];
  private readonly summary: HTMLElement;
  private readonly findings: HTMLElement[];
  private readonly fixAll: HTMLElement;
  private readonly tray: HTMLElement;

  constructor() {
    const lead = REVIEWERS[0];
    this.panel.el.innerHTML = `
      <article class="project-message user">
        <header><strong>You</strong><time>14:02</time></header>
        <div class="markdown"><div class="deep-review-request">
          <div class="deep-review-request-title">
            ${icon(ScanSearch, 15)}<strong>Deep review</strong><span>Uncommitted changes</span>
            <span class="diff-stat"><span class="diff-stat-add">+212</span><span class="diff-stat-del">−48</span></span>
          </div>
          <div class="deep-review-request-agents">
            ${REVIEWERS.map(chip).join("")}
            <span class="deep-review-arrow">→</span>${chip(lead)}
          </div>
        </div></div>
      </article>
      <div class="reel-phases">
        <div class="reel-phase" data-phase="council">
          <section class="deep-review-council">
            <button class="deep-review-council-toggle" aria-expanded="true">
              ${icon(Telescope, 14)}<strong>Council</strong><span>${REVIEWERS.length} reviewers at work</span>
              ${councilGlyphs}${icon(ChevronDown, 13)}
            </button>
            <div class="deep-review-grid" data-count="${REVIEWERS.length}">${REVIEWERS.map(pane).join("")}</div>
            <p class="muted deep-review-handover" data-handover>Handing over to ${lead.model}…</p>
          </section>
        </div>
        <div class="reel-phase" data-phase="report">
          <section class="deep-review-council">
            <button class="deep-review-council-toggle" aria-expanded="false">
              ${icon(Telescope, 14)}<strong>Council</strong><span>${REVIEWERS.length} reviewers · ${FINDINGS.length} findings kept</span>
              ${councilGlyphs}${icon(ChevronRight, 13)}
            </button>
          </section>
          <article class="project-message assistant">
            <header><strong>${glyph(lead.agent)}${lead.name}</strong></header>
            <div class="markdown"><p data-summary></p></div>
            <div class="deep-review-report">
              <section class="deep-review-tray">
                <ol class="deep-review-tasks">${FINDINGS.map(finding).join("")}</ol>
                <footer>
                  <span class="spacer"></span>
                  <button>Fix selected (2)</button>
                  <button class="primary" data-fix-all>${icon(Wrench, 14)}Fix all ${FINDINGS.length}</button>
                </footer>
              </section>
            </div>
          </article>
        </div>
      </div>`;
    const { el } = this.panel;
    this.council = query(el, '[data-phase="council"]');
    this.report = query(el, '[data-phase="report"]');
    this.handover = query(el, "[data-handover]");
    this.panes = [...el.querySelectorAll<HTMLElement>("[data-pane]")];
    this.summary = query(el, "[data-summary]");
    this.findings = [...el.querySelectorAll<HTMLElement>("[data-finding]")];
    this.fixAll = query(el, "[data-fix-all]");
    this.tray = query(el, ".deep-review-tray");
  }

  /** Centre of reviewer `index`'s pane, in panel pixels. */
  paneCentre(index: number): [number, number] {
    return this.panel.centre(this.panes[index]);
  }

  update(t: number) {
    const reporting = easeOut(span(t, REVIEW.report - 0.1, REVIEW.report + 0.35));
    this.council.style.opacity = (1 - span(t, REVIEW.report - 0.3, REVIEW.report)).toFixed(3);
    this.council.style.visibility = t < REVIEW.report ? "visible" : "hidden";
    this.report.style.opacity = reporting.toFixed(3);
    this.report.style.transform = `translateY(${((1 - reporting) * 10).toFixed(2)}px)`;
    this.report.style.visibility = reporting > 0 ? "visible" : "hidden";
    this.handover.style.opacity = easeOut(span(t, REVIEW.handover, REVIEW.handover + 0.25)).toFixed(3);

    REVIEWERS.forEach((r, i) => {
      const el = this.panes[i];
      const enter = easeOut(span(t, REVIEW.council + i * 0.1, REVIEW.council + 0.4 + i * 0.1));
      el.style.opacity = enter.toFixed(3);
      el.style.transform = `translateY(${((1 - enter) * 8).toFixed(2)}px)`;
      const first = r.calls[0][0];
      query(el, "[data-reply]").style.opacity = easeOut(span(t, first - 0.25, first)).toFixed(3);
      const progress = span(t, first, r.done);
      setText(
        query(el, "[data-tokens]"),
        progress > 0 ? `${Math.max(1, Math.round(r.tokens * progress))}k tokens` : "",
      );
      query(el, "[data-done]").style.display = t >= r.done ? "" : "none";
      r.calls.forEach(([at], c) => {
        const row = query(el, `[data-call="${c}"]`);
        const next = c + 1 < r.calls.length ? r.calls[c + 1][0] : r.answers;
        const live = t >= at && t < next;
        row.style.display = t >= at ? "" : "none";
        query(row, "[data-live-label]").style.display = live ? "" : "none";
        query(row, "[data-done-label]").style.display = live ? "none" : "";
      });
      const answer = query(el, "[data-answer]");
      answer.parentElement!.style.display = t >= r.answers ? "" : "none";
      setText(answer, typed(r.answer, span(t, r.answers, r.done - 0.1)));
    });

    // The summary streams in, tags and all.
    const total = SUMMARY.reduce((n, part) => n + (part.startsWith("<") ? 1 : part.length), 0);
    let budget = Math.round(total * span(t, REVIEW.report + 0.15, REVIEW.report + 1.5));
    let html = "";
    for (const part of SUMMARY) {
      if (budget <= 0) break;
      if (part.startsWith("<")) {
        html += part;
        budget -= 1;
      } else {
        html += part.slice(0, budget);
        budget -= part.length;
      }
    }
    if (this.summary.innerHTML !== html) this.summary.innerHTML = html;

    const trayIn = easeOut(span(t, REVIEW.report + 0.9, REVIEW.report + 1.3));
    this.tray.style.opacity = trayIn.toFixed(3);
    this.findings.forEach((el, i) => {
      const land = easeOut(span(t, REVIEW.report + 1.0 + i * 0.12, REVIEW.report + 1.35 + i * 0.12));
      el.style.opacity = land.toFixed(3);
      el.style.transform = `translateY(${((1 - land) * 8).toFixed(2)}px)`;
      const status = t >= REVIEW.fixed(i) ? "fixed" : t >= REVIEW.fix ? "fixing" : "open";
      if (el.dataset.status !== status) el.dataset.status = status;
      query(el, "[data-fixing]").style.display = status === "fixing" ? "" : "none";
      // Fix all takes every finding, ticked or not.
      if (t >= REVIEW.fix) query<HTMLInputElement>(el, "input").checked = true;
      else query<HTMLInputElement>(el, "input").checked = i < 2;
      setClass(el, "reel-fixed", status === "fixed");
    });
    const press = 1 - Math.abs(clamp((t - REVIEW.fix) / 0.16, -1, 1));
    this.fixAll.style.transform = `scale(${(1 - 0.06 * press).toFixed(3)})`;
    this.fixAll.style.filter = `brightness(${(1 + 0.25 * press).toFixed(3)})`;
    this.fixAll.style.opacity = t > REVIEW.fix + 0.2 ? "0.45" : "";

    shine(this.panel.el, t);
  }
}
