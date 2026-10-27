import { Activity } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { ComputerIcon } from "./ComputerSection";

/**
 * The card folded into the thread's right gutter, where there's never text:
 * the computer, and how many processes run there. One button, which opens it.
 */
export function RunningStripe({
  project,
  running,
  onOpen,
}: {
  project: Project;
  running: number;
  onOpen: () => void;
}) {
  const computer = project.computer?.name ?? "This computer";
  const label = running ? `${computer} · ${running} running` : computer;
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
        <ComputerIcon project={project} />
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
