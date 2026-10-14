import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { RelayCommand } from "../../../shared/commands";
import { memeToken, type MemeView } from "../../../shared/memes";
import { useMemes } from "./useMemes";

const typed = /^\s*\/meme\s([^\n]*)$/i;

/**
 * The memes with a picture that match what's typed: by name first, then
 * by meaning or who's in it, each in the list's order.
 */
export function matchingMemes(memes: MemeView[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ready = memes.filter((m) => m.url);
  if (!words.length) return ready;
  const rank = (m: MemeView) => {
    const title = `${m.id} ${m.name}`.toLowerCase();
    const all = `${title} ${m.meaning} ${m.find ?? ""}`.toLowerCase();
    if (!words.every((w) => all.includes(w))) return -1;
    if (!words.every((w) => title.includes(w))) return 2;
    return m.name.toLowerCase().startsWith(words[0]!) || m.id.startsWith(words[0]!) ? 0 : 1;
  };
  return ready
    .map((m) => [rank(m), m] as const)
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => m);
}

/**
 * `/meme` and what's typed after it: the matching memes in a row above the
 * composer to send, or, before memes are set up, the offer to set them up.
 */
export function useMemePicker({
  draft,
  disabled,
  send,
  setUp,
}: {
  draft: string;
  disabled: boolean;
  /** Sends a meme's line as the composer would. */
  send: (line: string) => void;
  /** Opens the thread that gets the memes without a picture. */
  setUp: () => void;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const query = typed.exec(draft)?.[1];
  const memes = useMemes(/^\s*\/meme\b/i.test(draft));
  const state = memes.data;
  const visible = query !== undefined && dismissed !== draft && !disabled;
  const items = useMemo(
    () => (state && query !== undefined ? matchingMemes(state.memes, query) : []),
    [state, query],
  );
  useEffect(() => setActive(0), [query]);
  const at = Math.min(active, Math.max(items.length - 1, 0));
  const mode = !state ? "loading" : state.setUp ? "row" : "setup";
  const pick = (meme: MemeView) => send(memeToken(meme));
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!visible || e.nativeEvent.isComposing) return false;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    if (e.key === "Escape") {
      setDismissed(draft);
      return handled();
    }
    const enter = (e.key === "Enter" && !e.shiftKey) || e.key === "Tab";
    if (mode === "setup") {
      if (!enter) return false;
      setUp();
      return handled();
    }
    if (mode !== "row" || !items.length) return false;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) {
      const next = at + step;
      if (next >= 0 && next < items.length) setActive(next);
      return handled();
    }
    if (!enter) return false;
    pick(items[at]!);
    return handled();
  }
  return {
    id,
    visible,
    activeId: visible && mode === "row" && items.length ? `${id}-${at}` : undefined,
    mode,
    state,
    query: query ?? "",
    items,
    active: at,
    setActive,
    pick,
    setUp,
    onKeyDown,
    dismiss: () => setDismissed(draft),
    /** `/meme <name>` sent as typed: the best match goes out. */
    command(command: RelayCommand, args: string): boolean | string | undefined {
      if (command !== "meme") return undefined;
      if (!state?.setUp) {
        setUp();
        return true;
      }
      const meme = matchingMemes(state.memes, args)[0];
      if (!args.trim()) return "Pick a meme from the list, or type its name after /meme.";
      if (!meme) return `No meme matches "${args.trim()}".`;
      pick(meme);
      return true;
    },
  };
}

export type MemePickerState = ReturnType<typeof useMemePicker>;
