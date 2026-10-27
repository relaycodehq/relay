import { Activity, Folder, FolderGit2 } from "lucide-react";
import { ComputerIcon, type CardComputer } from "./ComputerSection";

/** What the stripe says about the computer, for its label. */
function computerLabel(computer: CardComputer | undefined) {
  if (!computer) return "This computer";
  if (!computer.online) return `${computer.name} · offline`;
  return computer.name;
}

/**
 * The card folded into the thread's right gutter, where there's never text:
 * the computer, the folder the thread works in, and how many processes run
 * there. One button, which opens it.
 */
export function RunningStripe({
  computer,
  inWorktree,
  running,
  onOpen,
}: {
  computer?: CardComputer;
  /** The thread works in a worktree, not the project's checkout. */
  inWorktree: boolean;
  running: number;
  onOpen: () => void;
}) {
  const name = computerLabel(computer);
  const label = running ? `${name} · ${running} running` : name;
  return (
    <button
      type="button"
      className="running-stripe"
      aria-expanded={false}
      aria-label={label}
      title={label}
      onClick={onOpen}
    >
      <span className="running-stripe-mark">
        <ComputerIcon computer={computer} />
      </span>
      <span className="running-stripe-mark">
        {inWorktree ? (
          <FolderGit2 size={15} aria-hidden />
        ) : (
          <Folder size={15} aria-hidden />
        )}
      </span>
      {!!running && (
        <span className="running-stripe-mark">
          <Activity size={15} aria-hidden />
          <small>{running}</small>
        </span>
      )}
    </button>
  );
}
