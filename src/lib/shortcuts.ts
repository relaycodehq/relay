import { useEffect, useRef, useSyncExternalStore } from "react";
import { SETTINGS_PAGE } from "./settings-page";
import { z } from "zod";
import {
  accelerator,
  command,
  keyComboSchema,
  MAX_BINDINGS,
  menuShortcutIds,
  overlaps,
  reservedCombos,
  sameCombo,
  shortcutIds,
  type KeyCombo,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../shared/shortcuts";
import { mac } from "./mod-key";
import { persistedStore } from "./persisted-store";

/**
 * Every app shortcut's keys: the defaults, and whatever the user changed in
 * Settings. Per device, like the theme, so it lives in localStorage.
 */
const STORAGE_KEY = "relay-shortcuts";
/** Where the dictation key lived before every shortcut could change. */
const LEGACY_DICTATION = "relay-dictation-shortcut";

const bindingList = z.array(keyComboSchema).max(MAX_BINDINGS);

function legacyDictation(): ShortcutOverrides {
  try {
    const saved = localStorage.getItem(LEGACY_DICTATION);
    const combo = keyComboSchema.safeParse(JSON.parse(saved ?? "null"));
    return combo.success ? { dictate: [combo.data] } : {};
  } catch {
    return {};
  }
}

const store = persistedStore<ShortcutOverrides>(
  STORAGE_KEY,
  (saved) => {
    if (saved === null) return legacyDictation();
    const raw = JSON.parse(saved) as Record<string, unknown>;
    const overrides: ShortcutOverrides = {};
    for (const id of shortcutIds) {
      const list = bindingList.safeParse(raw?.[id]);
      if (list.success) overrides[id] = list.data;
    }
    return overrides;
  },
  (overrides) =>
    Object.keys(overrides).length ? JSON.stringify(overrides) : null,
);

// The keyboard's own layout names keys ("Z" on a QWERTZ keyboard's KeyY) and
// places the defaults, so ⌘N is the key with N printed on it.
let layout = new Map<string, string>();
const layoutListeners = new Set<() => void>();

type LayoutMap = { entries(): IterableIterator<[string, string]> };
async function readLayout() {
  try {
    const keyboard = (
      navigator as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }
    ).keyboard;
    const map = await keyboard?.getLayoutMap?.();
    if (!map) return;
    const next = new Map(map.entries());
    if (
      next.size === layout.size &&
      [...next].every(([code, key]) => layout.get(code) === key)
    )
      return;
    layout = next;
    defaults = resolveDefaults();
    for (const listener of layoutListeners) listener();
  } catch {
    // Labels fall back to a US keyboard's.
  }
}

/** The character a key types on this layout, for letters and punctuation. */
function typed(code: string) {
  if (
    !/^(Key[A-Z]|Minus|Equal|Bracket|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|IntlBackslash)/.test(
      code,
    )
  )
    return undefined;
  const key = layout.get(code);
  return key && key.length === 1 && key.trim() ? key : undefined;
}

const usKeys: Record<string, string> = {
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
  IntlBackslash: "§",
};
let defaults = resolveDefaults();

/** A default's key moved to wherever this layout prints its character. */
function placed(combo: KeyCombo): KeyCombo {
  const char = /^Key[A-Z]$/.test(combo.code)
    ? combo.code.slice(3).toLowerCase()
    : usKeys[combo.code];
  if (!char || !layout.size || typed(combo.code) === char) return combo;
  for (const [code, key] of layout)
    if (key === char && typed(code)) return { ...combo, code };
  return combo;
}

function resolveDefaults() {
  return Object.fromEntries(
    shortcutIds.map((id) => [id, command(id).defaults(mac).map(placed)]),
  ) as Record<ShortcutId, KeyCombo[]>;
}

export const defaultBindings = (id: ShortcutId) => defaults[id];

export const bindings = (id: ShortcutId): KeyCombo[] =>
  store.get()[id] ?? defaults[id];

const sameList = (a: KeyCombo[], b: KeyCombo[]) =>
  a.length === b.length && a.every((c, i) => sameCombo(c, b[i]));

export const isCustomized = (id: ShortcutId) =>
  !sameList(bindings(id), defaults[id]);

function subscribe(listener: () => void) {
  const off = store.subscribe(listener);
  layoutListeners.add(listener);
  return () => {
    off();
    layoutListeners.delete(listener);
  };
}

export function setBindings(id: ShortcutId, list: KeyCombo[]) {
  const next = { ...store.get() };
  if (sameList(list, defaults[id])) delete next[id];
  else next[id] = list.slice(0, MAX_BINDINGS);
  write(next);
}

export const resetBindings = (id: ShortcutId) => setBindings(id, defaults[id]);

export const resetAllBindings = () => write({});

function write(next: ShortcutOverrides) {
  try {
    localStorage.removeItem(LEGACY_DICTATION);
  } catch {
    // Nothing to migrate from then.
  }
  store.set(next);
}

/** How many shortcuts differ from their defaults. */
export const useCustomizedCount = () =>
  useShortcutValue(() => shortcutIds.filter(isCustomized).length);

export function useBindings(id: ShortcutId) {
  return useSyncExternalStore(subscribe, () => bindings(id));
}

// While Settings records a new shortcut, no shortcut does anything else.
let recording = 0;
export function setRecording(on: boolean) {
  recording = Math.max(0, recording + (on ? 1 : -1));
  void window.relay?.ignoreMenuShortcuts?.(recording > 0)?.catch(() => {});
}

type Modifiers = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};
type KeyEventLike = Modifiers & { code: string };

const sameModifiers = (e: Modifiers, c: KeyCombo) =>
  e.altKey === c.alt &&
  e.ctrlKey === c.ctrl &&
  e.metaKey === c.meta &&
  e.shiftKey === c.shift;

/** The combo of `id` this keypress is, if any. */
export function matchedCombo(id: ShortcutId, e: KeyEventLike) {
  if (recording) return undefined;
  return bindings(id).find(
    (c) => !c.twice && e.code === c.code && sameModifiers(e, c),
  );
}

export const matches = (id: ShortcutId, e: KeyEventLike) =>
  !!matchedCombo(id, e);

/**
 * Calls `onFire` when `id`'s keys are pressed anywhere in the window, except
 * while a dialog or menu is open.
 */
export function useShortcut(
  id: ShortcutId,
  enabled: boolean,
  onFire: () => void,
) {
  const fire = useRef(onFire);
  fire.current = onFire;
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (!matches(id, e)) return;
      if (
        document.querySelector(
          `dialog[open], [role="dialog"], [role="menu"], ${SETTINGS_PAGE}`,
        )
      )
        return;
      e.preventDefault();
      fire.current();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [id, enabled]);
}

/** Esc Esc and the like, which only a dedicated handler can tell apart. */
export const pressedTwice = (id: ShortcutId) =>
  bindings(id).some((c) => c.twice);

/** 1–9 when the keypress picks one of a digits command's slots. */
export function digitOf(id: ShortcutId, e: KeyEventLike) {
  if (recording) return undefined;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (!digit) return undefined;
  return bindings(id).some((c) => sameModifiers(e, c))
    ? Number(digit[1])
    : undefined;
}

/** Exactly the first binding's modifiers are held, none of them missing. */
export function holdsModifiersOf(id: ShortcutId, e: Modifiers) {
  const first = bindings(id)[0];
  return (
    !!first &&
    (first.alt || first.ctrl || first.meta) &&
    sameModifiers(e, first)
  );
}

const keyNames: Record<string, [onMac: string, elsewhere: string]> = {
  Space: ["Space", "Space"],
  Escape: ["Esc", "Esc"],
  Enter: ["↵", "Enter"],
  Tab: ["⇥", "Tab"],
  Backspace: ["⌫", "Backspace"],
  Delete: ["⌦", "Del"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  Home: ["Home", "Home"],
  End: ["End", "End"],
  PageUp: ["PgUp", "PgUp"],
  PageDown: ["PgDn", "PgDn"],
  Insert: ["Ins", "Ins"],
};

export function keyName(code: string) {
  const named = keyNames[code];
  if (named) return named[mac ? 0 : 1];
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return "Num" + code.slice(6);
  const own = typed(code);
  if (own) return own.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  return usKeys[code] ?? code;
}

/** The held modifiers as this platform writes them: "⌥⌘" or "Ctrl+Alt+". */
export function modifiersLabel(c: Omit<KeyCombo, "code">) {
  if (mac)
    return (
      (c.ctrl ? "⌃" : "") +
      (c.alt ? "⌥" : "") +
      (c.shift ? "⇧" : "") +
      (c.meta ? "⌘" : "")
    );
  return [
    c.ctrl && "Ctrl+",
    c.alt && "Alt+",
    c.shift && "Shift+",
    c.meta && "Super+",
  ]
    .filter(Boolean)
    .join("");
}

export function comboLabel(c: KeyCombo, digits?: boolean) {
  let key = keyName(c.code);
  let mods = c;
  // ⇧= reads as the + it types.
  if (c.code === "Equal" && c.shift && key === "=") {
    key = "+";
    mods = { ...c, shift: false };
  }
  if (digits) key = "1–9";
  const label = modifiersLabel(mods) + key;
  return c.twice ? `${label} ${label}` : label;
}

export const shortcutLabel = (id: ShortcutId) => {
  const first = bindings(id)[0];
  return first ? comboLabel(first, command(id).digits) : "";
};

/** Anything worked out from the keys, kept current as they change. */
export const useShortcutValue = <T extends string | number | boolean>(
  read: () => T,
) => useSyncExternalStore(subscribe, read);

export const useShortcutLabel = (id: ShortcutId) =>
  useShortcutValue(() => shortcutLabel(id));

/** Every change, for lists of shortcuts. */
export const useShortcutOverrides = () =>
  useSyncExternalStore(subscribe, store.get);

/** The keys spelled out, so a search for "cmd shift n" finds ⇧⌘N. */
export function comboWords(c: KeyCombo) {
  return [
    c.ctrl && "ctrl control",
    c.alt && (mac ? "option alt" : "alt"),
    c.shift && "shift",
    c.meta && (mac ? "cmd command" : "super"),
    keyName(c.code),
    c.twice && "twice",
  ]
    .filter(Boolean)
    .join(" ");
}

/** `text` with its shortcut after `separator`, or alone when it has none. */
export function useTitleWithShortcut(
  id: ShortcutId,
  text: string,
  separator = " · ",
) {
  const label = useShortcutLabel(id);
  return label ? text + separator + label : text;
}

/** For `aria-keyshortcuts`: "Meta+L". */
export function ariaShortcut(id: ShortcutId) {
  return bindings(id)
    .filter((c) => !c.twice)
    .map((c) =>
      [
        c.ctrl && "Control",
        c.alt && "Alt",
        c.shift && "Shift",
        c.meta && "Meta",
        keyName(c.code),
      ]
        .filter(Boolean)
        .join("+"),
    )
    .join(" ");
}

export type Conflict =
  { kind: "command"; id: ShortcutId } | { kind: "reserved"; what: string };

/** What already answers `combo`, other than `id` itself. */
export function conflictOf(
  id: ShortcutId,
  combo: KeyCombo,
): Conflict | undefined {
  const digits = command(id).digits;
  const reserved = reservedCombos(mac).find(([r]) =>
    overlaps(placed(r), false, combo, digits),
  );
  if (reserved) return { kind: "reserved", what: reserved[1] };
  for (const other of shortcutIds) {
    if (other === id) continue;
    const theirs = command(other).digits;
    if (bindings(other).some((c) => overlaps(c, theirs, combo, digits)))
      return { kind: "command", id: other };
  }
}

/** Gives `combo` to `id`, taking it away from whichever command had it. */
export function reassign(id: ShortcutId, list: KeyCombo[], combo: KeyCombo) {
  const digits = command(id).digits;
  const next = { ...store.get() };
  for (const other of shortcutIds) {
    if (other === id) continue;
    const theirs = command(other).digits;
    const kept = bindings(other).filter(
      (c) => !overlaps(c, theirs, combo, digits),
    );
    if (kept.length !== bindings(other).length) {
      if (sameList(kept, defaults[other])) delete next[other];
      else next[other] = kept;
    }
  }
  if (sameList(list, defaults[id])) delete next[id];
  else next[id] = list;
  write(next);
}

// The app menu (reload, zoom, full screen) lives in the main process; it
// hears about changed keys, named the way this layout types them.
let sentMenu = "";
function syncMenu() {
  const menu: Record<string, string[]> = {};
  for (const id of menuShortcutIds)
    if (isCustomized(id))
      menu[id] = bindings(id)
        .map((c) => accelerator(c, mac, typed))
        .filter((a): a is string => !!a);
  const json = JSON.stringify(menu);
  if (json === sentMenu) return;
  sentMenu = json;
  void window.relay?.setMenuShortcuts?.(menu)?.catch(() => {});
}

export function initShortcuts() {
  subscribe(syncMenu);
  syncMenu();
  void readLayout();
  // Switching input sources is done outside Relay.
  window.addEventListener("focus", () => void readLayout());
}
