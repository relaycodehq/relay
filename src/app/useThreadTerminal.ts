import { useShortcut } from "../lib/shortcuts";
import { terminalBlocked } from "./thread-folder";
import {
  terminalFor,
  terminalKey,
} from "../features/terminal/thread-terminals";
import {
  dockTabs,
  setTerminalOpen,
  useTerminalOpen,
} from "../features/terminal/terminal-dock";
import type { ShellNavigation } from "./useShellNavigation";

export type ThreadTerminalDrawer = ReturnType<typeof useThreadTerminal>;

/** The open thread's terminal drawer; each thread remembers whether it's open. */
export function useThreadTerminal({
  project,
  chat,
  scope,
  draftWorkspace,
  inbox,
}: Pick<
  ShellNavigation,
  "project" | "chat" | "scope" | "draftWorkspace" | "inbox"
>) {
  const key = project ? terminalKey(project.id, chat?.id ?? null) : "";
  const open = useTerminalOpen(key);
  const blocked = terminalBlocked(chat, scope, draftWorkspace);
  function toggle() {
    if (!project || inbox || blocked) return;
    if (!open)
      terminalFor(
        project.id,
        chat?.id ?? null,
        dockTabs(key).front,
      ).focusOnShow = true;
    setTerminalOpen(key, !open);
  }
  useShortcut("terminal", true, toggle);
  return {
    open,
    /** Why it can't open, when it can't. */
    blocked,
    shown: !!project && !inbox && open && !blocked,
    toggle,
    close: () => setTerminalOpen(key, false),
  };
}
