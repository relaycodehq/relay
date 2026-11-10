import type { Terminal } from "@xterm/xterm";
import { api } from "../../lib/api";

/**
 * A single line copied with its line break, as from a code block, would leave
 * the shell on an empty second line under the command instead of after it.
 */
export function pasteText(text: string) {
  const command = text.replace(/[\r\n]+$/, "");
  const severalLines = /[\r\n]/.test(command);
  return severalLines ? text : command;
}

/** A paste held back until the user says to go on. */
export interface HeldPaste {
  text: string;
  /** How many lines the shell would run, one after the other. */
  lines: number;
}

/**
 * Whether `clipboard` goes to the shell now. Several lines pasted to a
 * program that didn't ask for bracketed paste (a Python prompt, `cat`, an
 * older shell) each run as they arrive, so the user is asked first.
 */
export function pasteDecision(
  clipboard: string,
  bracketedPaste: boolean,
): { hold: false; text: string } | ({ hold: true } & HeldPaste) {
  const text = pasteText(clipboard);
  const lines = text.replace(/[\r\n]+$/, "").split(/\r\n|\r|\n/).length;
  if (bracketedPaste || lines === 1) return { hold: false, text };
  return { hold: true, text, lines };
}

/**
 * Copy on select, right-click to copy or paste, and paste without a lone
 * line's line break. `hold` gets a paste that wants the user's go-ahead.
 */
export function wireClipboard(
  term: Terminal,
  element: HTMLElement,
  hold: (paste: HeldPaste) => void,
) {
  const paste = (clipboard: string) => {
    const decision = pasteDecision(clipboard, term.modes.bracketedPasteMode);
    if (decision.hold) hold(decision);
    else term.paste(decision.text);
  };

  // Once the mouse lets go rather than on every step of the drag.
  element.addEventListener("mouseup", (e) => {
    if (e.button === 0 && term.hasSelection())
      void api.writeClipboard(term.getSelection()).catch(() => {});
  });

  // Right-click copies a selection, or pastes when there's none, the way
  // Windows Terminal does.
  element.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      void api.writeClipboard(term.getSelection()).catch(() => {});
      term.clearSelection();
    } else {
      void api
        .readClipboard()
        .then((text) => text && paste(text))
        .catch(() => {});
    }
    term.focus();
  });

  // Ahead of xterm's own handler, which would send the text as it is.
  element.addEventListener(
    "paste",
    (e) => {
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      paste(text);
    },
    { capture: true },
  );
}
