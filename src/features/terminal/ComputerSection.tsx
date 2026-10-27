import { Laptop, PanelRightClose, Server } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { ComputerLoad } from "./TaskLoad";

/** The card's head: the computer the project's threads run on, and its load. */
export function ComputerSection({
  project,
  onFold,
}: {
  project: Project;
  /** Folds the card to its pill; left out while there's nothing to fold to. */
  onFold?: () => void;
}) {
  const elsewhere = project.computer;
  return (
    <section className="running-computer">
      <div className="running-computer-head">
        {elsewhere ? (
          <Server size={15} aria-hidden />
        ) : (
          <Laptop size={15} aria-hidden />
        )}
        <span className="running-computer-name">
          {elsewhere ? elsewhere.name : "This computer"}
        </span>
        {onFold && (
          <button
            type="button"
            className="running-card-button"
            title="Fold"
            aria-label="Fold the card"
            onClick={onFold}
          >
            <PanelRightClose size={14} />
          </button>
        )}
      </div>
      {/* The load read here is this computer's, not the one the project is on. */}
      {!elsewhere && <ComputerLoad />}
    </section>
  );
}
