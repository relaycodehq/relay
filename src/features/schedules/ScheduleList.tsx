import { Plus } from "lucide-react";
import type { Project } from "../../../shared/projects";
import {
  nextRun,
  scheduleWhenLabel,
  SCRATCHPAD_SCHEDULE,
  type Schedule,
} from "../../../shared/schedules";
import { useProjectList } from "../../lib/workspace-queries";
import { ProjectBadge } from "../projects/ProjectBadge";
import { fromNow } from "./schedule-format";
import {
  chooseNewSchedule,
  pickSchedule,
  shownSchedule,
  useSchedulePick,
} from "./useSchedulePick";
import { useSchedules } from "./useSchedules";
// Its rows are the Activity view's cards.
import "../sidebar/sidebar.css";
import "./schedules.css";

/** Stands in for a Scratchpad schedule's project, which each run makes anew. */
export const scratchpadProject: Project = {
  id: SCRATCHPAD_SCHEDULE,
  name: "Scratchpad",
  path: "",
  repository: null,
  added: 0,
  scratch: true,
};

export const scheduleProject = (
  s: Pick<Schedule, "projectId">,
  projects: Project[],
) =>
  s.projectId === SCRATCHPAD_SCHEDULE
    ? scratchpadProject
    : projects.find((p) => p.id === s.projectId);

/** When it runs next; a past due time owed after a sleep reads as now. */
export const nextAt = (s: Schedule) =>
  nextRun(s, Math.max(s.handledUntil, Date.now() - 1));

/** The sidebar while Schedules is open: one card per schedule, and New schedule. */
export function ScheduleList() {
  const pick = useSchedulePick();
  const projects = useProjectList().data ?? [];
  const schedules = useSchedules();
  const list = schedules.data ?? [];
  const shown = shownSchedule(list, pick);
  return (
    <div className="sb">
      <div className="sb-top">
        <h2 className="sb-top-title">
          Schedules {list.length > 0 && <small>({list.length})</small>}
        </h2>
        <button
          className="sb-top-button"
          aria-label="New schedule"
          title="New schedule"
          onClick={chooseNewSchedule}
        >
          <Plus size={16} />
        </button>
      </div>
      <nav className="sb-scroll schedule-list" aria-label="Schedules">
        {list.map((s) => (
          <ScheduleCard
            key={s.id}
            schedule={s}
            project={scheduleProject(s, projects)}
            selected={s.id === shown?.id}
            onPick={() => pickSchedule(s.id)}
          />
        ))}
        {schedules.isSuccess && !list.length && (
          <p className="sb-note">No schedules yet.</p>
        )}
      </nav>
    </div>
  );
}

/** Where it runs and when next, its name, and how often. */
function ScheduleCard({
  schedule: s,
  project,
  selected,
  onPick,
}: {
  schedule: Schedule;
  project: Project | undefined;
  selected: boolean;
  onPick: () => void;
}) {
  const last = s.runs[0];
  return (
    <button
      type="button"
      className={[
        "sb-card",
        selected && "selected",
        // Paused ones dim, except the one open, as in Activity.
        !selected && !s.enabled && "dim",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={selected || undefined}
      title={last?.summary}
      onClick={onPick}
    >
      <span className="sb-card-top">
        <ProjectBadge project={project} />
        <span className="sb-card-name">
          <span className="sb-card-project">
            {project?.name ?? "Removed project"}
          </span>
        </span>
        <ScheduleState schedule={s} />
      </span>
      <span className="sb-card-title">{s.name}</span>
      <span className="sb-card-meta">
        {scheduleWhenLabel(s)}
        {last?.outcome === "failed" && (
          <span className="schedule-failed">· Last run failed</span>
        )}
      </span>
    </button>
  );
}

function ScheduleState({ schedule: s }: { schedule: Schedule }) {
  if (s.runs[0]?.outcome === "running")
    return <span className="sb-card-state running">Running</span>;
  if (!s.enabled) return <span className="sb-card-state">Paused</span>;
  return <span className="sb-card-state">{fromNow(nextAt(s))}</span>;
}
