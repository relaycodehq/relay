import { Server, ServerOff } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { projectComputer, usePairedComputers } from "./usePairedComputers";
import "./handoff.css";

/** Before a thread starts in a project on another computer: where it'll run. */
export function HomeComputerLine({ project }: { project: Project }) {
  const computers = usePairedComputers(true);
  const where = projectComputer(project, computers.data);
  if (!where) return null;
  const { online } = where;
  const gone = !!computers.data?.every((c) => c.id !== where.id);
  const connecting =
    computers.data?.find((c) => c.id === where.id)?.status === "connecting";
  return (
    <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
      {online ? <Server size={12} /> : <ServerOff size={12} />}
      <span>
        {online
          ? `On ${where.name}`
          : gone
            ? `${where.name} isn't paired anymore`
            : connecting
              ? `Connecting to ${where.name}…`
              : `${where.name} is offline`}
      </span>
    </div>
  );
}
