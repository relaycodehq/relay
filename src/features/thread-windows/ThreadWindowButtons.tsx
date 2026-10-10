import type { ReactNode } from "react";
import { SquareArrowDownLeft, SquareArrowOutUpRight } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";

function MoveButton({
  label,
  icon,
  onMove,
}: {
  label: string;
  icon: ReactNode;
  onMove: () => void;
}) {
  const keys = useShortcutLabel("thread-window");
  useShortcut("thread-window", true, onMove);
  return (
    <button
      type="button"
      className="pane-toggle"
      aria-label={label}
      aria-keyshortcuts={keys || undefined}
      title={keys ? `${label} · ${keys}` : label}
      onClick={onMove}
    >
      {icon}
    </button>
  );
}

/** Pops the main window's thread out into a window of its own. */
export function PopOutButton({
  chat,
  onError,
}: {
  chat: ChatSummary;
  onError: (error: unknown) => void;
}) {
  // A thread on another computer has nothing to show in a window here.
  if (chat.sentTo) return null;
  return (
    <MoveButton
      label="Open in new window"
      icon={<SquareArrowOutUpRight size={14} />}
      onMove={() =>
        void api.openThreadWindow(chat.projectId, chat.id).catch(onError)
      }
    />
  );
}

/** Puts a thread's own window's thread back in the main window. */
export function BackButton({ chatId }: { chatId: string }) {
  return (
    <MoveButton
      label="Back to the main window"
      icon={<SquareArrowDownLeft size={14} />}
      onMove={() => void api.returnThreadWindow(chatId).catch(() => {})}
    />
  );
}
