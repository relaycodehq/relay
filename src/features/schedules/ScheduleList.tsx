import type { Project } from "../../../shared/projects";
import {
  nextRun,
  scheduleWhenLabel,
  SCRATCHPAD_SCHEDULE,
  type Schedule,
} from "../../../shared/schedules";
import { ProjectBadge } from "../projects/ProjectBadge";
import { fromNow } from "./schedule-format";

/** Stands in for a Scratchpad schedule's project, which each run makes anew. */
export const scratchpadProject: Project = {
  id: SCRATCHPAD_SCHEDULE,
  name: "Scratchpad",
  path: "",
  repository: null,
  added: 0,
  scratch: true,
};

export const scheduleProject = (s: Pick<Schedule, "projectId">, projects: Project[]) =>
  s.projectId === SCRATCHPAD_SCHEDULE
    ? scratchpadProject
    : projects.find((p) => p.id === s.projectId);

/** When it runs next; a past due time owed after a sleep reads as now. */
export const nextAt = (s: Schedule) => nextRun(s, Math.max(s.handledUntil, Date.now() - 1));

/** The schedules, each row saying when it runs next and what its last run did. */
export function ScheduleList({
  schedules,
  projects,
  picked,
  onPick,
}: {
  schedules: Schedule[];
  projects: Project[];
  picked?: string;
  onPick: (id: string) => void;
}) {
  return (
    <nav className="schedule-list" aria-label="Schedules">
      {schedules.map((s) => {
        const project = scheduleProject(s, projects);
        const last = s.runs[0];
        return (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === picked || undefined}
            data-off={!s.enabled || undefined}
            onClick={() => onPick(s.id)}
          >
            <ProjectBadge project={project} />
            <span className="schedule-row-top">
              <strong>{s.name}</strong>
              <em>{s.enabled ? fromNow(nextAt(s)) : "Paused"}</em>
            </span>
            <span className="schedule-row-when">
              {scheduleWhenLabel(s)} · {project?.name ?? "Removed project"}
            </span>
            <small
              className="schedule-row-last"
              data-outcome={last?.outcome}
              title={last?.summary}
            >
              {last ? (last.outcome === "running" ? "Running now" : last.summary) : "Hasn't run yet"}
            </small>
          </button>
        );
      })}
    </nav>
  );
}
