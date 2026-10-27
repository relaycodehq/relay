import type { ReactNode } from "react";
import { Laptop, PanelRightClose, Server, ServerOff } from "lucide-react";
import { ComputerLoad } from "./TaskLoad";

/** Another computer the thread runs on, as the card shows it. */
export interface CardComputer {
  name: string;
  online: boolean;
  /** How the thread is doing there, under the name. */
  status?: ReactNode;
}

/** A server for another computer, crossed out while it's offline; a laptop for this one. */
export function ComputerIcon({ computer }: { computer?: CardComputer }) {
  if (!computer) return <Laptop size={15} aria-hidden />;
  if (!computer.online) return <ServerOff size={15} aria-hidden />;
  return <Server size={15} aria-hidden />;
}

/** The card's head: the computer the thread runs on, and its load. */
export function ComputerSection({
  computer,
  actions,
  onFold,
}: {
  /** None for this computer. */
  computer?: CardComputer;
  /** The open thread's own buttons, e.g. Hand off. */
  actions?: ReactNode;
  /** Folds the card into the stripe. */
  onFold: () => void;
}) {
  return (
    <section className="running-computer">
      <div className="running-computer-head">
        <ComputerIcon computer={computer} />
        <span className="running-computer-name">
          {computer ? computer.name : "This computer"}
        </span>
        <span className="running-card-actions">
          {actions}
          <button
            type="button"
            className="running-card-button"
            title="Fold"
            aria-label="Fold the card"
            onClick={onFold}
          >
            <PanelRightClose size={14} />
          </button>
        </span>
      </div>
      {/* The load read here is this computer's, so another one shows how the thread is doing there instead. */}
      {computer ? (
        <div className="running-computer-status">{computer.status}</div>
      ) : (
        <ComputerLoad />
      )}
    </section>
  );
}
