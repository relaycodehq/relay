import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useAppearance } from "../../lib/appearance";
import { terminalFont, useTypography } from "../../lib/typography";
import { terminalTheme } from "./terminal-theme";
import {
  setTerminalFont,
  setTerminalTheme,
  type ThreadTerminal,
} from "./thread-terminals";
import "./terminal-drawer.css";

/** One shell's screen, wherever its tab is: the drawer or the panel. */
export function TerminalView({ terminal }: { terminal: ThreadTerminal }) {
  useSyncExternalStore(terminal.subscribe, terminal.snapshot);
  const { palette, accent } = useAppearance();
  const body = useRef<HTMLDivElement>(null);
  // Before the terminal draws, so it never shows xterm's own colors first.
  useLayoutEffect(
    () => setTerminalTheme(terminalTheme(palette, accent)),
    [palette, accent],
  );
  const { family, size } = terminalFont(useTypography());
  useLayoutEffect(() => setTerminalFont(family, size), [family, size]);
  useLayoutEffect(() => {
    const host = body.current!;
    host.appendChild(terminal.element);
    terminal.show();
    const observer = new ResizeObserver(() => terminal.fitSoon());
    observer.observe(host);
    return () => {
      observer.disconnect();
      terminal.hide();
    };
  }, [terminal]);
  return (
    <div className="terminal-view">
      <div className="terminal-drawer-body" ref={body} />
      {terminal.error && (
        <div className="terminal-drawer-error" role="alert">
          <p>{terminal.error}</p>
          <button type="button" onClick={() => void terminal.start()}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/** The folder a shell works in, by its last name. */
export const terminalFolder = (terminal: ThreadTerminal) =>
  terminal.cwd?.split(/[\\/]/).filter(Boolean).pop();
