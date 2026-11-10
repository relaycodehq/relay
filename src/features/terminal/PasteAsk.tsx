import { useEffect, useRef } from "react";
import type { HeldPaste } from "./terminal-clipboard";

/**
 * The question over a paste that would run several lines one by one: Enter
 * pastes, Escape cancels. Focus lands on Paste so neither key reaches the shell.
 */
export function PasteAsk({
  paste,
  onAnswer,
}: {
  paste: HeldPaste;
  onAnswer: (paste: boolean) => void;
}) {
  const pasteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => pasteButton.current?.focus(), [paste]);
  return (
    <div
      className="terminal-paste-ask"
      role="alert"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onAnswer(false);
      }}
    >
      <span>The shell would run these {paste.lines} lines one by one.</span>
      <button
        type="button"
        className="primary"
        ref={pasteButton}
        onClick={() => onAnswer(true)}
      >
        Paste
      </button>
      <button type="button" onClick={() => onAnswer(false)}>
        Cancel
      </button>
    </div>
  );
}
