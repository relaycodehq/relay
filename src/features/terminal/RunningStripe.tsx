import { Activity } from "lucide-react";
import { ComputerIcon, type CardComputer } from "./ComputerSection";

/** What the stripe says about the computer, for its label. */
function computerLabel(computer: CardComputer | undefined) {
  if (!computer) return "This computer";
  if (!computer.online) return `${computer.name} · offline`;
  return computer.name;
}

/**
 * The card folded into the thread's right gutter, where there's never text:
 * the computer, and how many processes run there. One button, which opens it.
 */
export function RunningStripe({
  computer,
  running,
  onOpen,
}: {
  computer?: CardComputer;
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
      {!!running && (
        <span className="running-stripe-mark">
          <Activity size={15} aria-hidden />
          <small>{running}</small>
        </span>
      )}
    </button>
  );
}
