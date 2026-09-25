import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCw, SquareTerminal, X } from "lucide-react";
import { useAppearance } from "../lib/appearance";
import { terminalTheme } from "../lib/terminal-theme";
import {
  setTerminalFont,
  setTerminalTheme,
  type ThreadTerminal,
} from "../lib/thread-terminals";
import { terminalFont, useTypography } from "../lib/typography";
import { IconButton } from "./ui";
import "./terminal-drawer.css";

const heightKey = "relay-terminal-height";
const defaultHeight = 260,
  minHeight = 120;

/** The thread's shell, docked under the workspace panes. */
export function TerminalDrawer({
  terminal,
  worktree,
  onClose,
}: {
  terminal: ThreadTerminal;
  /** The shell works in the thread's worktree, not the checkout. */
  worktree: boolean;
  onClose: () => void;
}) {
  useSyncExternalStore(terminal.subscribe, terminal.snapshot);
  const { palette, accent } = useAppearance();
  const section = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => {
    const stored = Number(localStorage.getItem(heightKey));
    return stored >= minHeight ? stored : defaultHeight;
  });
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
  const resize = (value: number) => {
    // Leave the panes above room to stay usable.
    const room = (section.current?.parentElement?.clientHeight ?? 800) - 160;
    const next = Math.round(
      Math.max(minHeight, Math.min(Math.max(minHeight, room), value)),
    );
    setHeight(next);
    localStorage.setItem(heightKey, String(next));
  };
  const folder = terminal.cwd?.split(/[\\/]/).filter(Boolean).pop();
  return (
    <section
      ref={section}
      className="terminal-drawer"
      style={{ height }}
      aria-label="Terminal"
    >
      <div
        className="terminal-drawer-resizer"
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuemin={minHeight}
        aria-valuenow={height}
        tabIndex={0}
        onDoubleClick={() => resize(defaultHeight)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            resize(height + (e.key === "ArrowUp" ? 20 : -20));
          }
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          const handle = e.currentTarget;
          const start = e.clientY,
            origin = height;
          handle.setPointerCapture(e.pointerId);
          const move = (event: PointerEvent) =>
            resize(origin + start - event.clientY);
          const stop = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", stop);
            handle.removeEventListener("pointercancel", stop);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", stop);
          handle.addEventListener("pointercancel", stop);
        }}
      />
      <header className="terminal-drawer-header">
        <SquareTerminal size={14} aria-hidden />
        <span className="terminal-drawer-title">Terminal</span>
        {folder && (
          <span className="terminal-drawer-cwd" title={terminal.cwd}>
            {folder}
          </span>
        )}
        {worktree && <small className="terminal-drawer-where">worktree</small>}
        <span className="spacer" />
        <IconButton
          label="Restart shell"
          disabled={terminal.status === "starting"}
          onClick={() => terminal.restart()}
        >
          <RotateCw size={13} />
        </IconButton>
        <IconButton label="Hide terminal" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </header>
      <div className="terminal-drawer-body" ref={body} />
      {terminal.error && (
        <div className="terminal-drawer-error" role="alert">
          <p>{terminal.error}</p>
          <button type="button" onClick={() => void terminal.start()}>
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
