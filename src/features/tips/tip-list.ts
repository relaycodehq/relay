// Every tip Clip knows, most worth knowing first. Each goes quiet once it's
// set up, used, acted on or dismissed.
import type { ShortcutId } from "../../../shared/shortcuts";
import type { SettingsCategory } from "../../lib/settings-page";

/** What Clip knows about this Relay; a setting is undefined while it's still asking. */
export type TipFacts = {
  /** The agent this turn runs on. */
  provider?: string;
  /** "Flag what I'd miss" is off. */
  watchOff?: boolean;
  /** Read aloud runs here but has no voice downloaded. */
  readAloudMissing?: boolean;
  noPhone?: boolean;
  noComputer?: boolean;
  noImportedTheme?: boolean;
  /** Shortcuts pressed and features tried on this device (`lib/used`). */
  used: ReadonlySet<string>;
  /** Shortcuts someone unbound, which a tip can't send them to. */
  unbound: ReadonlySet<string>;
};

export type Tip = {
  id: string;
  /** One short line, no full stop; `{shortcut-id}` shows its keys as bound now. */
  ask: string;
  cta?: string;
  /** Where the CTA goes. */
  settings?: SettingsCategory;
  /** The CTA turns it on right there instead. */
  turnOn?: "watch";
  relevant: (facts: TipFacts) => boolean;
};

/** The shortcuts `{…}` in an ask names, in order. */
export const askedKeys = (ask: string) =>
  [...ask.matchAll(/\{([\w-]+)\}/g)].map((m) => m[1] as ShortcutId);

/** A shortcut's tip, quiet once any of the keys it names has been pressed. */
function keys(id: ShortcutId, ask: string, more: Partial<Tip> = {}): Tip {
  const named = askedKeys(ask);
  return {
    id: `keys:${id}`,
    ask,
    cta: "All shortcuts",
    settings: "shortcuts",
    relevant: (f) =>
      !named.some((k) => f.used.has(`shortcut:${k}`) || f.unbound.has(k)),
    ...more,
  };
}

/** A feature's tip, quiet once it's been tried. */
const feature = (
  id: string,
  ask: string,
  also: (f: TipFacts) => boolean = () => true,
): Tip => ({ id, ask, relevant: (f) => !f.used.has(id) && also(f) });

/** Agents that "Flag what I'd miss" and /goal work with. */
const WATCHABLE = new Set(["claude", "codex"]);

export const tips: Tip[] = [
  {
    id: "watch",
    ask: "Relay can check each turn for anything you'd likely miss",
    cta: "Turn on",
    turnOn: "watch",
    relevant: (f) => f.watchOff === true && WATCHABLE.has(f.provider ?? ""),
  },
  keys("stop", "{stop} stops the agent mid-turn"),
  keys("send-new-thread", "{send-new-thread} sends, then opens a new thread"),
  feature("goal", "/goal keeps the agent going until the goal is met", (f) =>
    WATCHABLE.has(f.provider ?? ""),
  ),
  feature("mention", "Type @ in your message to attach a file"),
  keys("quote", "Select part of an answer, {quote} quotes it in your reply"),
  keys("dictate", "{dictate} lets you talk instead of type"),
  keys("quick-next", "{quick-next} flips through your model presets", {
    cta: "Set up presets",
    settings: "quick-switch",
  }),
  keys("effort-up", "{effort-up} {effort-down} raise or lower thinking effort"),
  {
    id: "phone",
    ask: "Follow and answer threads from your phone",
    cta: "Pair a phone",
    settings: "phone",
    relevant: (f) => f.noPhone === true,
  },
  {
    id: "read-aloud",
    ask: "Relay can read answers out loud",
    cta: "Set it up",
    settings: "read-aloud",
    relevant: (f) => f.readAloudMissing === true,
  },
  feature(
    "move-worktree",
    "Right-click a thread to move it into its own worktree",
  ),
  feature("deep-review", "Deep review sets several agents on the same diff"),
  keys("jump-thread", "{jump-thread} jumps to that thread in Activity"),
  keys("settle", "{settle} marks a thread done, {undo} brings it back"),
  keys("activity", "{activity} shows all your threads at once"),
  keys("terminal", "{terminal} opens this thread's terminal"),
  keys("new-scratch", "{new-scratch} opens a Scratchpad for a quick question"),
  keys("edit-queued", "{edit-queued} pulls a queued message back to edit"),
  {
    id: "computers",
    ask: "Hand a thread over to another computer running Relay",
    cta: "Set it up",
    settings: "computers",
    relevant: (f) => f.noComputer === true,
  },
  {
    id: "vscode-theme",
    ask: "Relay can wear your VS Code theme",
    cta: "Import one",
    settings: "appearance",
    relevant: (f) => f.noImportedTheme === true,
  },
  keys("sidebar", "{sidebar} hides or shows the sidebar"),
  keys("pr-open", "On Pull requests, {pr-open} opens a PR from its URL"),
];
