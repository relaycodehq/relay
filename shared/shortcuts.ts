import { z } from "zod";

/**
 * A key combination, matched by physical key (`KeyboardEvent.code`) so it
 * works the same on any keyboard layout.
 */
export interface KeyCombo {
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** Pressed twice in a row, like Esc Esc to stop an answer. */
  twice?: boolean;
}

export const keyComboSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
    alt: z.boolean(),
    ctrl: z.boolean(),
    meta: z.boolean(),
    shift: z.boolean(),
    twice: z.literal(true).optional(),
  })
  .strict();

export type ShortcutGroup =
  "General" | "Threads" | "Composer" | "Reviews" | "Editor" | "Window";

export const shortcutGroups: ShortcutGroup[] = [
  "General",
  "Threads",
  "Composer",
  "Reviews",
  "Editor",
  "Window",
];

export interface ShortcutCommand {
  title: string;
  group: ShortcutGroup;
  description?: string;
  /** More words for the settings search. */
  keywords?: string;
  /** Plain keys are fine: it only listens outside text fields. */
  bare?: boolean;
  /** The binding holds modifiers; any digit 1–9 picks which. */
  digits?: boolean;
  /** Handled by the app menu in the main process. */
  menu?: boolean;
  defaults: (mac: boolean) => KeyCombo[];
}

/** `mod` is ⌘ on macOS and Ctrl elsewhere; the key is the last part. */
function combo(mac: boolean, spec: string, twice?: boolean): KeyCombo {
  const parts = spec.split("+");
  const code = parts.pop()!;
  const has = (name: string) => parts.includes(name);
  return {
    code,
    alt: has("alt"),
    ctrl: has("ctrl") || (!mac && has("mod")),
    meta: has("meta") || (mac && has("mod")),
    shift: has("shift"),
    ...(twice ? { twice } : {}),
  };
}
const one =
  (spec: string, twice?: boolean) =>
  (mac: boolean): KeyCombo[] => [combo(mac, spec, twice)];

const shortcutCommands = {
  settings: {
    title: "Open settings",
    group: "General",
    keywords: "preferences",
    defaults: one("mod+Comma"),
  },
  "new-thread": {
    title: "New thread",
    group: "General",
    defaults: one("mod+KeyN"),
  },
  "new-scratch": {
    title: "New Scratchpad chat",
    group: "General",
    defaults: one("mod+shift+KeyN"),
  },
  sidebar: {
    title: "Pin or unpin the projects sidebar",
    group: "General",
    defaults: one("mod+KeyB"),
  },
  activity: {
    title: "View activity",
    group: "General",
    keywords: "inbox bell notifications",
    defaults: one("mod+alt+KeyU"),
  },
  terminal: {
    title: "Show or hide the terminal",
    group: "General",
    keywords: "shell console drawer",
    // ⌘J on macOS, Ctrl+` everywhere, as in VS Code.
    defaults: (mac) =>
      mac
        ? [combo(mac, "meta+KeyJ"), combo(mac, "ctrl+Backquote")]
        : [combo(mac, "ctrl+Backquote")],
  },
  "jump-thread": {
    title: "Open one of the first nine activity threads",
    group: "Threads",
    description:
      "Hold the modifiers for a moment on the activity view to see the numbers.",
    keywords: "jump switch number",
    digits: true,
    defaults: one("mod+Digit1"),
  },
  settle: {
    title: "Settle the open thread",
    group: "Threads",
    keywords: "done hide triage",
    defaults: one("mod+KeyE"),
  },
  stop: {
    title: "Stop the answer and pause queued messages",
    group: "Threads",
    description:
      "Esc Esc needs a second press, so a stray Esc can't stop anything. Keys of your own stop right away.",
    keywords: "cancel interrupt escape",
    defaults: one("Escape", true),
  },
  "effort-down": {
    title: "Less reasoning effort",
    group: "Composer",
    keywords: "effort thinking left",
    defaults: one("mod+alt+ArrowLeft"),
  },
  "effort-up": {
    title: "More reasoning effort",
    group: "Composer",
    keywords: "effort thinking right",
    defaults: one("mod+alt+ArrowRight"),
  },
  "quick-prev": {
    title: "Previous quick-switch preset",
    group: "Composer",
    description:
      "Switches agent, model and effort together. Set presets up in AI models → Quick switch.",
    keywords: "quick switch preset model agent left",
    // Win+Ctrl+arrows switch desktops on Windows, so no ⊞ there.
    defaults: (mac) => [
      combo(mac, mac ? "ctrl+meta+ArrowLeft" : "ctrl+alt+shift+ArrowLeft"),
    ],
  },
  "quick-next": {
    title: "Next quick-switch preset",
    group: "Composer",
    keywords: "quick switch preset model agent right",
    defaults: (mac) => [
      combo(mac, mac ? "ctrl+meta+ArrowRight" : "ctrl+alt+shift+ArrowRight"),
    ],
  },
  dictate: {
    title: "Dictate",
    group: "Composer",
    description:
      "Tap to start and tap again to finish, or hold to talk and let go. Esc discards what you said.",
    keywords: "dictation voice speech microphone push to talk",
    defaults: (mac) => [combo(mac, mac ? "alt+Space" : "ctrl+Space")],
  },
  quote: {
    title: "Quote the selected text in your message",
    group: "Composer",
    keywords: "selection add to chat",
    defaults: one("mod+KeyL"),
  },
  "review-files": {
    title: "Show or hide a review's file list",
    group: "Reviews",
    defaults: one("mod+alt+KeyB"),
  },
  "review-read": {
    title: "Mark a review file as read",
    group: "Reviews",
    keywords: "viewed",
    bare: true,
    defaults: one("KeyV"),
  },
  "review-next": {
    title: "Next review file",
    group: "Reviews",
    bare: true,
    defaults: one("KeyJ"),
  },
  "review-prev": {
    title: "Previous review file",
    group: "Reviews",
    bare: true,
    defaults: one("KeyK"),
  },
  "pr-search": {
    title: "Search pull requests",
    group: "Reviews",
    keywords: "find filter",
    defaults: one("mod+KeyF"),
  },
  "pr-open": {
    title: "Open a pull request by URL",
    group: "Reviews",
    keywords: "link",
    defaults: one("mod+KeyK"),
  },
  save: {
    title: "Save the open file",
    group: "Editor",
    defaults: one("mod+KeyS"),
  },
  definition: {
    title: "Go to definition",
    group: "Editor",
    keywords: "symbol navigate declaration",
    defaults: one("F12"),
  },
  references: {
    title: "Find usages",
    group: "Editor",
    keywords: "references symbol",
    defaults: (mac) => [combo(mac, "shift+F12"), combo(mac, "alt+F7")],
  },
  reload: {
    title: "Reload the window",
    group: "Window",
    keywords: "refresh",
    menu: true,
    // Plain ⌘R/Ctrl+R belongs to Replace in the code editor.
    defaults: one("mod+shift+KeyR"),
  },
  devtools: {
    title: "Developer tools",
    group: "Window",
    keywords: "inspect console debug",
    menu: true,
    defaults: (mac) => [combo(mac, mac ? "alt+meta+KeyI" : "ctrl+shift+KeyI")],
  },
  "actual-size": {
    title: "Actual size",
    group: "Window",
    keywords: "zoom reset",
    menu: true,
    defaults: one("mod+Digit0"),
  },
  "zoom-in": {
    title: "Zoom in",
    group: "Window",
    keywords: "bigger larger scale",
    menu: true,
    // ⌘+, the key "=" shares.
    defaults: one("mod+shift+Equal"),
  },
  "zoom-out": {
    title: "Zoom out",
    group: "Window",
    keywords: "smaller scale",
    menu: true,
    defaults: one("mod+Minus"),
  },
  fullscreen: {
    title: "Full screen",
    group: "Window",
    menu: true,
    defaults: (mac) => [combo(mac, mac ? "ctrl+meta+KeyF" : "F11")],
  },
} satisfies Record<string, ShortcutCommand>;

export type ShortcutId = keyof typeof shortcutCommands;
export const shortcutIds = Object.keys(shortcutCommands) as ShortcutId[];
export const command = (id: ShortcutId): ShortcutCommand =>
  shortcutCommands[id];

export type MenuShortcutId = {
  [K in ShortcutId]: (typeof shortcutCommands)[K] extends { menu: true }
    ? K
    : never;
}[ShortcutId];
export const menuShortcutIds = shortcutIds.filter(
  (id): id is MenuShortcutId => !!command(id).menu,
);

/** A user's changes; a command left out keeps its defaults. */
export type ShortcutOverrides = Partial<Record<ShortcutId, KeyCombo[]>>;

export const MAX_BINDINGS = 3;

/** What Settings sends the main process: accelerators of changed menu keys. */
export const menuAcceleratorsSchema = z.partialRecord(
  z.enum(menuShortcutIds as [MenuShortcutId, ...MenuShortcutId[]]),
  z
    .array(z.string().regex(/^[A-Za-z0-9+\-=[\];',./`\\]{1,48}$/))
    .max(MAX_BINDINGS),
);

/** Keys the app menu and the OS keep: Edit, Quit, Hide and the rest. */
export function reservedCombos(mac: boolean): [KeyCombo, string][] {
  const list: [string, string][] = mac
    ? [
        ["mod+KeyQ", "quits Relay"],
        ["mod+KeyH", "hides Relay"],
        ["alt+mod+KeyH", "hides other apps"],
        ["mod+KeyM", "minimizes the window"],
        ["mod+KeyZ", "is Undo"],
        ["shift+mod+KeyZ", "is Redo"],
        ["mod+KeyX", "is Cut"],
        ["mod+KeyC", "is Copy"],
        ["mod+KeyV", "is Paste"],
        ["alt+shift+mod+KeyV", "is Paste and Match Style"],
        ["mod+KeyA", "is Select All"],
      ]
    : [
        ["mod+KeyQ", "quits Relay"],
        ["mod+KeyW", "closes the window"],
        ["mod+KeyM", "minimizes the window"],
        ["mod+KeyZ", "is Undo"],
        ["shift+mod+KeyZ", "is Redo"],
        ["mod+KeyY", "is Redo"],
        ["mod+KeyX", "is Cut"],
        ["mod+KeyC", "is Copy"],
        ["mod+KeyV", "is Paste"],
        ["mod+KeyA", "is Select All"],
        ["alt+F4", "closes the window"],
      ];
  return list.map(([spec, what]) => [combo(mac, spec), what]);
}

const modifiersEqual = (a: KeyCombo, b: KeyCombo) =>
  a.alt === b.alt &&
  a.ctrl === b.ctrl &&
  a.meta === b.meta &&
  a.shift === b.shift;

const isDigit = (code: string) => /^Digit[1-9]$/.test(code);

export const sameCombo = (a: KeyCombo, b: KeyCombo) =>
  a.code === b.code && !!a.twice === !!b.twice && modifiersEqual(a, b);

/** Whether the two would fire on one keypress; a digits binding covers 1–9. */
export function overlaps(
  a: KeyCombo,
  aDigits: boolean | undefined,
  b: KeyCombo,
  bDigits: boolean | undefined,
) {
  if (!modifiersEqual(a, b) || !!a.twice !== !!b.twice) return false;
  if (aDigits && bDigits) return true;
  if (aDigits) return isDigit(b.code);
  if (bDigits) return isDigit(a.code);
  return a.code === b.code;
}

export const modifierCode =
  /^(Alt|Control|Meta|Shift|OS|CapsLock|Fn)(Left|Right)?$/;
const fKey = /^F([1-9]|1[0-9]|2[0-4])$/;
/** Keys that type something, so they can't be a shortcut alone in a field. */
const printable =
  /^(Key[A-Z]|Digit\d|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|IntlBackslash)$/;

export type Recorded =
  | { kind: "wait" }
  | { kind: "combo"; combo: KeyCombo }
  | { kind: "invalid"; reason: string };

/**
 * What a keypress in the shortcut recorder makes of `id`'s binding. Esc and
 * Backspace are the recorder's own keys and never get here.
 */
export function recordCombo(
  e: {
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  id: ShortcutId,
  mac: boolean,
): Recorded {
  if (!e.code || modifierCode.test(e.code)) return { kind: "wait" };
  const next: KeyCombo = {
    code: e.code,
    alt: e.altKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
  };
  const held = next.alt || next.ctrl || next.meta;
  const mods = mac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt";
  if (/^(Enter|NumpadEnter|Tab|Escape)$/.test(next.code))
    return {
      kind: "invalid",
      reason: "Enter, Tab and Esc keep their usual jobs. Try another key.",
    };
  const cmd = command(id);
  if (cmd.digits) {
    if (!isDigit(next.code) || !held)
      return {
        kind: "invalid",
        reason: `Hold ${mods} and press any digit from 1 to 9.`,
      };
    return { kind: "combo", combo: { ...next, code: "Digit1" } };
  }
  if (!held && !fKey.test(next.code)) {
    if (!cmd.bare)
      return {
        kind: "invalid",
        reason: `Add ${mods}. A plain key would type instead.`,
      };
    if (!printable.test(next.code))
      return {
        kind: "invalid",
        reason: `That key moves around the page. Try a letter, or add ${mods}.`,
      };
  }
  return { kind: "combo", combo: next };
}

const acceleratorKeys: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};

/**
 * Electron's accelerator for a combo, or undefined for a key it can't name.
 * Menus match the character a key types, so `typed` names it on the
 * keyboard's own layout when it knows.
 */
export function accelerator(
  c: KeyCombo,
  mac: boolean,
  typed?: (code: string) => string | undefined,
) {
  let key: string | undefined;
  let shift = c.shift;
  const own = typed?.(c.code);
  if (c.code === "Equal" && shift && (!own || own === "=")) {
    // Electron's own zoom-in: "Plus" is ⇧= on most layouts.
    key = "Plus";
    shift = false;
  } else if (own && /^[a-z0-9\-=[\];',./`\\]$/i.test(own))
    key = own.toUpperCase();
  else if (/^Key[A-Z]$/.test(c.code)) key = c.code.slice(3);
  else if (/^Digit\d$/.test(c.code)) key = c.code.slice(5);
  else if (/^Numpad\d$/.test(c.code)) key = "num" + c.code.slice(6);
  else if (fKey.test(c.code)) key = c.code;
  else key = acceleratorKeys[c.code];
  if (!key || c.twice) return undefined;
  return [
    c.ctrl && (mac ? "Control" : "Ctrl"),
    c.alt && "Alt",
    shift && "Shift",
    c.meta && (mac ? "Command" : "Super"),
    key,
  ]
    .filter(Boolean)
    .join("+");
}
