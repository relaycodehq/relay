import { useRef, useState, useSyncExternalStore } from "react";
import { RotateCw, SquareTerminal, X } from "lucide-react";
import { IconButton } from "../../ui/ui";
import { PaneTabs } from "../../ui/PaneTabs";
import { Splitter } from "../../ui/Splitter";
import {
  newTerminalSlot,
  setDockTabs,
  setTerminalOpen,
  useDockTabs,
} from "./terminal-dock";
import { closeTerminal, terminalFor, terminalKey } from "./thread-terminals";
import { TerminalView, terminalFolder } from "./TerminalView";

const heightKey = "relay-terminal-height";
const defaultHeight = 260,
  minHeight = 120;

/** "Terminal", "Terminal 2", …: by place, since slots aren't numbers. */
export const terminalLabel = (index: number) =>
  index ? `Terminal ${index + 1}` : "Terminal";

/** The thread's shells, docked under the workspace panes as tabs. */
export function TerminalDrawer({
  projectId,
  chatId,
  worktree,
  onClose,
}: {
  projectId: string;
  chatId: string | null;
  /** The shells work in the thread's worktree, not the checkout. */
  worktree: boolean;
  onClose: () => void;
}) {
  const key = terminalKey(projectId, chatId);
  const tabs = useDockTabs(key);
  const terminal = terminalFor(projectId, chatId, tabs.front);
  useSyncExternalStore(terminal.subscribe, terminal.snapshot);
  const section = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(() => {
    const stored = Number(localStorage.getItem(heightKey));
    return stored >= minHeight ? stored : defaultHeight;
  });
  const resize = (value: number) => {
    // Leave the panes above room to stay usable.
    const room = (section.current?.parentElement?.clientHeight ?? 800) - 160;
    const next = Math.round(
      Math.max(minHeight, Math.min(Math.max(minHeight, room), value)),
    );
    setHeight(next);
    localStorage.setItem(heightKey, String(next));
  };
  const add = () => {
    const slot = newTerminalSlot();
    terminalFor(projectId, chatId, slot).focusOnShow = true;
    setDockTabs(key, { slots: [...tabs.slots, slot], front: slot });
  };
  const close = (slot: string) => {
    closeTerminal(projectId, chatId, slot);
    const slots = tabs.slots.filter((s) => s !== slot);
    if (!slots.length) {
      // The next open starts afresh with a first shell.
      setDockTabs(key, { slots: [""], front: "" });
      setTerminalOpen(key, false);
      return;
    }
    const at = tabs.slots.indexOf(slot);
    setDockTabs(key, {
      slots,
      front:
        tabs.front === slot
          ? slots[Math.min(at, slots.length - 1)]!
          : tabs.front,
    });
  };
  const folder = terminalFolder(terminal);
  return (
    <section
      ref={section}
      className="terminal-drawer"
      style={{ height }}
      aria-label="Terminal"
    >
      <Splitter
        className="terminal-drawer-resizer"
        label="Resize terminal"
        orientation="horizontal"
        step={20}
        value={height}
        min={minHeight}
        begin={() => {
          const origin = height;
          return (delta) => resize(origin - delta);
        }}
        onReset={() => resize(defaultHeight)}
      />
      <header className="terminal-drawer-header">
        <PaneTabs
          tabs={tabs.slots.map((slot, i) => ({
            key: slot,
            label: terminalLabel(i),
            icon: <SquareTerminal size={13} />,
          }))}
          front={tabs.front}
          onFront={(front) => setDockTabs(key, { ...tabs, front })}
          onClose={close}
          add={{ label: "New terminal", onClick: add }}
        />
        {folder && (
          <span className="terminal-drawer-cwd" title={terminal.cwd}>
            {folder}
          </span>
        )}
        {worktree && <small className="terminal-drawer-where">worktree</small>}
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
      <TerminalView key={terminal.key} terminal={terminal} />
    </section>
  );
}
