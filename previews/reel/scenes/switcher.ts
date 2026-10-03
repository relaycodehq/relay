import {
  ArrowUp,
  Bot,
  ChevronDown,
  LockKeyholeOpen,
  Mic,
  Paperclip,
  Zap,
} from "lucide-react";
import "../../../src/components/composer-model-picker.css";
import "../../../src/components/quick-switch.css";
import { clamp, easeOut, span } from "../math";
import { Panel } from "../stage";
import { glyph, icon, query, setText, typed, type Agent } from "../kit";

interface Preset {
  agent: Agent;
  name: string;
  effort: string;
  /** What the composer's own effort control reads with this preset. */
  control: string;
  fast?: boolean;
}

export const PRESETS: Preset[] = [
  { agent: "claude", name: "Haiku 4.5", effort: "Low", control: "Low" },
  { agent: "claude", name: "Sonnet 5.5", effort: "Medium", control: "Medium · 1M" },
  { agent: "claude", name: "Opus 5.5", effort: "High", control: "High · 1M" },
  { agent: "claude", name: "Fable 5.1", effort: "Max", control: "Max · 1M" },
  { agent: "codex", name: "GPT-6-Sol", effort: "High", control: "High" },
  { agent: "codex", name: "GPT-6-Astra", effort: "Extra high", control: "Extra high", fast: true },
  { agent: "opencode", name: "Kimi K2", effort: "Default", control: "Default" },
  { agent: "cursor", name: "Composer 2.5", effort: "Default", control: "Default" },
];

const START = 2;
/** Scene time and direction of each ⌃⌘ arrow press. */
const PRESSES: [number, number][] = [
  [3.0, 1],
  [3.5, 1],
  [3.95, 1],
  [4.4, 1],
  [5.15, -1],
  [5.55, -1],
  [5.95, -1],
];
const ROLL = 0.42;
const HOLD = 0.85;
const PROMPT =
  "Split ProjectChat.tsx by responsibility. Behaviour unchanged, every spec green.";
const TYPING = [0.4, 2.5] as const;
export const SENT = 7.0;

/** Each press with the preset it lands on, for whoever scores the scene. */
export const SWITCHES = PRESSES.reduce<{ at: number; preset: Preset }[]>(
  (list, [at, dir]) => {
    const index =
      (list.length ? PRESETS.indexOf(list[list.length - 1].preset) : START) + dir;
    return [...list, { at, preset: PRESETS[index] }];
  },
  [],
);

const WIDTH = 760;

export class Switcher {
  readonly composer = new Panel(WIDTH, 164, "reel-bare");
  readonly drum = new Panel(274, 208, "reel-bare");
  private readonly prompt: HTMLElement;
  private readonly trigger: HTMLElement;
  private readonly effort: HTMLElement;
  private readonly send: HTMLElement;
  private readonly rows: HTMLElement[];
  private readonly popup: HTMLElement;
  private shown = -1;

  constructor() {
    this.composer.el.innerHTML = `
      <form class="project-composer">
        <div class="composer-prompt-input"><p><span data-prompt></span><i class="reel-caret"></i></p></div>
        <div class="composer-tools">
          <button class="composer-control composer-model-trigger" data-trigger></button>
          <span class="composer-divider"></span>
          <button class="composer-control"><span data-effort></span>${icon(ChevronDown, 12)}</button>
          <span class="composer-divider"></span>
          <button class="composer-control composer-runtime">${icon(LockKeyholeOpen, 14)}Full access${icon(ChevronDown, 12)}</button>
          <span class="composer-divider"></span>
          <button class="composer-control composer-interaction">${icon(Bot, 16)}<span>Build</span>${icon(ChevronDown, 12)}</button>
          <button class="composer-control">${icon(Paperclip, 15)}</button>
          <span class="spacer"></span>
          <button class="composer-control dictation-mic">${icon(Mic, 15)}</button>
          <button class="primary send-message">${icon(ArrowUp, 18)}</button>
        </div>
      </form>`;
    this.prompt = query(this.composer.el, "[data-prompt]");
    this.trigger = query(this.composer.el, "[data-trigger]");
    this.effort = query(this.composer.el, "[data-effort]");
    this.send = query(this.composer.el, ".send-message");

    this.drum.el.innerHTML = `
      <div class="quick-switch-anchor reel-drum">
        <div class="composer-select-popup quick-popup quick-drum">
          <div class="composer-menu-label">Quick switch<kbd>⌃⌘ ←→</kbd></div>
          <div class="quick-drum-view">
            <span class="quick-drum-band"></span>
            ${PRESETS.map(
              (p) => `
              <button type="button" class="quick-drum-row" data-provider="${p.agent}">
                ${glyph(p.agent)}<span class="quick-name">${p.name}</span>
                ${p.fast ? icon(Zap, 12, "quick-fast") : ""}
                <span class="quick-row-effort">${p.effort}</span>
              </button>`,
            ).join("")}
          </div>
        </div>
      </div>`;
    this.popup = query(this.drum.el, ".quick-popup");
    this.rows = [...this.drum.el.querySelectorAll<HTMLElement>(".quick-drum-row")];
    this.drum.solid = false;
  }

  update(t: number) {
    setText(
      this.prompt,
      t >= SENT ? "" : typed(PROMPT, span(t, TYPING[0], TYPING[1])),
    );

    let rolled = START;
    let picked = START;
    for (const [at, dir] of PRESSES) {
      rolled += dir * easeOut(span(t, at, at + ROLL), 4);
      if (t >= at) picked += dir;
    }
    const preset = PRESETS[picked];
    if (this.shown !== picked) {
      this.shown = picked;
      this.trigger.innerHTML = `${glyph(preset.agent)}<span>${preset.name}</span>${icon(ChevronDown, 12)}`;
      setText(this.effort, preset.control);
      this.popup.dataset.provider = preset.agent;
      this.rows.forEach((row, i) =>
        row.setAttribute("aria-pressed", String(i === picked)),
      );
    }
    this.rows.forEach((row, i) => {
      const d = i - rolled;
      row.style.setProperty("--d", d.toFixed(4));
      row.style.setProperty("--ad", Math.min(Math.abs(d), 4).toFixed(4));
      // Past a quarter turn a row is on the far side of the drum.
      row.style.visibility = Math.abs(d) > 4.2 ? "hidden" : "visible";
    });

    const first = PRESSES[0][0];
    const last = PRESSES[PRESSES.length - 1][0] + HOLD;
    const open = Math.min(span(t, first, first + 0.14), 1 - span(t, last, last + 0.14));
    this.drum.opacity = clamp(open);
    this.popup.style.transform = `translateY(${((1 - clamp(open)) * 4).toFixed(2)}px)`;

    // The send button dips as it's pressed.
    const press = 1 - Math.abs(clamp((t - SENT) / 0.16, -1, 1));
    this.send.style.transform = `scale(${(1 - 0.14 * press).toFixed(3)})`;
    this.send.style.filter = `brightness(${(1 + 0.35 * press).toFixed(3)})`;
  }
}
