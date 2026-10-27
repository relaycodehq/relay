import type { ReactNode } from "react";
import { Laptop, PanelRightClose, Server } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { ComputerLoad } from "./TaskLoad";

/** A server for a project on another computer, a laptop for this one. */
export function ComputerIcon({ project }: { project: Project }) {
  if (project.computer) return <Server size={15} aria-hidden />;
  return <Laptop size={15} aria-hidden />;
}

/** The card's head: the computer the project's threads run on, and its load. */
export function ComputerSection({
  project,
  actions,
  onFold,
}: {
  project: Project;
  /** The open thread's own buttons, e.g. Hand off. */
  actions?: ReactNode;
  /** Folds the card into the stripe. */
  onFold: () => void;
}) {
  const elsewhere = project.computer;
  return (
    <section className="running-computer">
      <div className="running-computer-head">
        <ComputerIcon project={project} />
        <span className="running-computer-name">
          {elsewhere ? elsewhere.name : "This computer"}
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
      {/* The load read here is this computer's, not the one the project is on. */}
      {!elsewhere && <ComputerLoad />}
    </section>
  );
}
