import { useEffect, useRef, useState } from "react";
import type { ChatSummary } from "../../../shared/projects";
import { modifierCode } from "../../../shared/shortcuts";
import { mac } from "../../lib/mod-key";
import { digitOf, holdsModifiersOf, useShortcut } from "../../lib/shortcuts";
import type { ThreadActions } from "./useThreadActions";
import { noteUsed } from "../../lib/used";

const CMD_HINT_DELAY_MS = 500;
/** How long a jump asked for from a thread's window waits for the cards. */
const ASKED_JUMP_TTL_MS = 10_000;

let askedJump: { index: number; at: number } | undefined;
const askedListeners = new Set<() => void>();

/**
 * `jump-thread` pressed in a thread's own window: opens Activity's
 * `index`th card here, once the cards are in if this window just opened.
 */
export function askJump(index: number) {
  askedJump = { index, at: Date.now() };
  askedListeners.forEach((listener) => listener());
}

/**
 * The `settle` shortcut on the open thread, and `jump-thread`'s digits onto
 * Activity's first nine threads while `jumping`. Returns whether their hints
 * show: holding ⌘ on its own for a beat on the activity view shows ⌘1–⌘9 on
 * the first nine cards (or whichever modifiers open them). ⌘ used as part of
 * another shortcut or a ⌘-click never shows them.
 */
export function useActivityKeys({
  active,
  cards,
  chatId,
  jumping,
  actions: { open, settle },
}: {
  /** Every open thread, started ones included, for `settle`. */
  active: ChatSummary[];
  /** The numbered cards, in order, for `jump-thread`. */
  cards: ChatSummary[];
  /** The open thread. */
  chatId: string | undefined;
  jumping: boolean;
  actions: Pick<ThreadActions, "open" | "settle">;
}) {
  const [held, setHeld] = useState(false);
  const jumpTo = useRef<(index: number) => boolean>(() => false);
  useShortcut("settle", true, () => {
    const c = active.find((a) => a.id === chatId);
    if (c && !c.waiting) settle(c);
  });
  useEffect(() => {
    let reveal: number | undefined;
    const cancel = () => {
      clearTimeout(reveal);
      reveal = undefined;
    };
    const release = () => {
      cancel();
      setHeld(false);
    };
    const down = (e: KeyboardEvent) => {
      // Ctrl keys typed in a terminal belong to its shell.
      if (
        !mac &&
        e.ctrlKey &&
        (e.target as Element | null)?.closest?.(".xterm")
      )
        return release();
      if (!holdsModifiersOf("jump-thread", e)) release();
      else if (!modifierCode.test(e.code)) cancel();
      else if (reveal === undefined)
        reveal = window.setTimeout(() => setHeld(true), CMD_HINT_DELAY_MS);
      const digit = digitOf("jump-thread", e);
      if (digit && jumpTo.current(digit - 1)) {
        e.preventDefault();
        noteUsed("shortcut:jump-thread");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!holdsModifiersOf("jump-thread", e)) release();
    };
    const click = (e: PointerEvent) => {
      if (holdsModifiersOf("jump-thread", e)) cancel();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", click);
    window.addEventListener("blur", release);
    return () => {
      cancel();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", click);
      window.removeEventListener("blur", release);
    };
  }, []);
  jumpTo.current = (index) => {
    const c = cards[index];
    if (!jumping || !c) return false;
    open(c);
    return true;
  };
  const takeAsked = useRef(() => {});
  takeAsked.current = () => {
    if (!askedJump) return;
    if (Date.now() - askedJump.at > ASKED_JUMP_TTL_MS) askedJump = undefined;
    else if (cards.length) {
      jumpTo.current(askedJump.index);
      askedJump = undefined;
    }
  };
  useEffect(() => {
    const take = () => takeAsked.current();
    askedListeners.add(take);
    return () => void askedListeners.delete(take);
  }, []);
  useEffect(() => takeAsked.current(), [cards.length]);
  return held;
}
