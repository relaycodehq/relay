import { useRef, type KeyboardEvent, type RefObject } from "react";
import type { PromptInputHandle } from "./prompt/usePromptHandle";
import { stepHistory, type HistoryNav } from "./prompt-history";

/**
 * ↑/↓ through what was sent in the conversation, from an empty composer; see
 * prompt-history. The list is only read on the first ↑, never per keystroke.
 */
export function usePromptHistory(
  prompt: RefObject<PromptInputHandle | null>,
  sent: (() => string[]) | undefined,
) {
  const nav = useRef<HistoryNav | null>(null);
  return {
    /** Takes ↑ or ↓ when it recalls a message; false leaves the key alone. */
    keyDown(e: KeyboardEvent, draft: string) {
      if (!sent || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return false;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
      if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
      const input = prompt.current;
      if (!input) return false;
      let caret = 0;
      if (nav.current) {
        const at = input.caret();
        caret = at && at.start === at.end ? at.start : -1;
      }
      const step = stepHistory(
        nav.current,
        draft,
        caret,
        e.key === "ArrowUp" ? "older" : "newer",
        sent,
      );
      if (!step) return false;
      e.preventDefault();
      if (step === "hold") return true;
      // Cleared first: the edit reports itself before it is known.
      nav.current = null;
      const shown = input.replace(step.text);
      nav.current = step.nav && shown ? { ...step.nav, ...shown } : null;
      return true;
    },
    /** Typing in a recalled message ends the recall. */
    edited(text: string) {
      if (nav.current && nav.current.text !== text) nav.current = null;
    },
    /** So does moving the caret off its end. */
    moved(caret: number) {
      if (nav.current && nav.current.caret !== caret) nav.current = null;
    },
  };
}
