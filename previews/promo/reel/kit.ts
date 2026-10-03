import { createElement, type FC, type SVGProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LucideIcon } from "lucide-react";
import {
  ClaudeAI,
  OpenAI,
  OpenCode,
} from "../../../src/vendor/t3code/model-picker/ProviderIcons";
import { CursorGlyph } from "../../../src/features/agents/CursorGlyph";
import { DeviceIcon } from "../../../src/features/handoff/DeviceIcon";

export type Agent = "claude" | "codex" | "opencode" | "cursor";

/** The colours quick switch gives each agent (quick-switch.css). */
export const agentColor: Record<Agent, [number, number, number]> = {
  claude: [0.85, 0.47, 0.34],
  codex: [0.45, 0.56, 0.97],
  opencode: [0.23, 0.72, 0.56],
  cursor: [0.83, 0.84, 0.87],
};

const glyphs: Record<Agent, FC<SVGProps<SVGSVGElement>>> = {
  claude: ClaudeAI,
  codex: OpenAI,
  opencode: OpenCode,
  cursor: CursorGlyph,
};

/** A lucide icon as markup, the way the app's own components size it. */
export const icon = (Icon: LucideIcon, size: number, className?: string) =>
  renderToStaticMarkup(
    createElement(Icon, { size, className, "aria-hidden": true }),
  );

export const glyph = (agent: Agent) =>
  renderToStaticMarkup(
    createElement(glyphs[agent], {
      className: "provider-glyph",
      "aria-hidden": true,
    }),
  );

/** The app's own glyph for a computer, picked from its name. */
export const device = (name: string, size: number) =>
  renderToStaticMarkup(createElement(DeviceIcon, { name, size }));

function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export const badge = (name: string) =>
  `<span class="sb-project-badge" style="--hue:${projectHue(name)}">${name.slice(0, 1).toUpperCase()}</span>`;

export const person = (login: string, size = 16) =>
  `<span class="pulls-person" style="--hue:${projectHue(login)};--size:${size}px">${login.slice(0, 2).toUpperCase()}</span>`;

export const spinner = (size: number) =>
  `<span class="spinner steady"><svg width="${size}" height="${size}" viewBox="0 0 16 16"><circle class="spinner-track" cx="8" cy="8" r="6.25"/><circle class="spinner-arc" cx="8" cy="8" r="6.25" pathLength="100"/></svg></span>`;

/** Elapsed time as the activity cards word it: 26s, 4m 12s, 1h 3m. */
export function elapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** As much of `text` as has been typed or streamed at `progress` (0..1). */
export const typed = (text: string, progress: number) =>
  text.slice(0, Math.round(text.length * Math.min(1, Math.max(0, progress))));

export function query<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`No ${selector} in the panel`);
  return found;
}

/** Sets text only when it changed, so an idle frame costs no layout. */
export function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el: Element, name: string, on: boolean) {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/** Spins every spinner under `root` to where it would be at film time `t`. */
export function spin(root: ParentNode, t: number) {
  const angle = ((t / 1.6) * 360) % 360;
  for (const el of root.querySelectorAll<HTMLElement>(".spinner"))
    el.style.transform = `rotate(${angle.toFixed(1)}deg)`;
}

/** Moves the highlight across every live label, as `.live-shine` does. */
export function shine(root: ParentNode, t: number) {
  const k = (t / 2.2) % 1;
  for (const el of root.querySelectorAll<HTMLElement>(".live-shine")) {
    const width = el.offsetWidth;
    el.style.backgroundPosition = `${(-58.5 + k * (width + 117)).toFixed(1)}px 0, 0 0`;
  }
}

const CLAUDE_GLYPHS = "·✢✳✶✻✽✻✶✳✢";

/** The Claude thinking glyph's ten steps over 1.5s. */
export const thinkingGlyph = (t: number) =>
  CLAUDE_GLYPHS[Math.floor(((t / 1.5) % 1) * 10)];
