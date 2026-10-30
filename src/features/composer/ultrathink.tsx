import { useCallback, useMemo, useRef, type RefObject } from "react";
import { ultrathinkPattern } from "./prompt/ultrathink-word";
import type { PromptInputHandle } from "./prompt/usePromptHandle";
import "./ultrathink.css";

/** Whether the message being written asks Claude to ultrathink, and the switch that adds or removes the keyword. */
export type Ultrathink = { on: boolean; toggle: () => void };

type TextEdit = { start: number; end: number; text: string };

export const asksUltrathink = (text: string) =>
  firstKeyword(text) !== undefined;

/**
 * Puts the keyword at the end of the draft, or takes every one out with a
 * space beside it. Each edit's offsets are in the text the edits before it
 * left, so they apply in order.
 */
export function ultrathinkEdits(text: string): TextEdit[] {
  if (!asksUltrathink(text)) {
    const gap = text && !/\s$/.test(text) ? " " : "";
    return [{ start: text.length, end: text.length, text: `${gap}ultrathink` }];
  }
  const edits: TextEdit[] = [];
  let rest = text;
  for (let found = firstKeyword(rest); found; found = firstKeyword(rest)) {
    const edit = removal(rest, found);
    edits.push(edit);
    rest = rest.slice(0, edit.start) + rest.slice(edit.end);
  }
  return edits;
}

/** Only for Claude: it is Claude Code that reads the keyword. */
export function useUltrathink(
  to: string,
  text: string,
  prompt: RefObject<PromptInputHandle | null>,
): Ultrathink | undefined {
  const latest = useRef(text);
  latest.current = text;
  const toggle = useCallback(() => {
    for (const edit of ultrathinkEdits(latest.current))
      prompt.current?.insertText(edit);
  }, [prompt]);
  const on = asksUltrathink(text);
  return useMemo(
    () => (to === "claude" ? { on, toggle } : undefined),
    [to, on, toggle],
  );
}

/** The composer's rainbow edge while the message asks to ultrathink. */
export function UltrathinkRing() {
  return <span className="ultrathink-ring" aria-hidden />;
}

function firstKeyword(text: string) {
  const match = text.match(new RegExp(ultrathinkPattern.source, "i"));
  if (match?.index === undefined) return;
  return { start: match.index, end: match.index + match[0].length };
}

/** The keyword's range, with the space before it, or else the one after it. */
function removal(text: string, { start, end }: { start: number; end: number }) {
  if (text[start - 1] === " ") return { start: start - 1, end, text: "" };
  if (text[end] === " ") return { start, end: end + 1, text: "" };
  return { start, end, text: "" };
}
