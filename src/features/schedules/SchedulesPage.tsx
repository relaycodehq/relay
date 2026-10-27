// The Schedules page, from the activity bar: prompts Relay sends on its own.
// The sidebar lists them; the page shows the one picked there.
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Project } from "../../../shared/projects";
import {
  SCRATCHPAD_SCHEDULE,
  type ScheduleInput,
} from "../../../shared/schedules";
import { api } from "../../lib/api";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { ScheduleEditor } from "./ScheduleEditor";
import { ScheduleGallery } from "./ScheduleGallery";
import type { ScheduleTemplate } from "./schedule-templates";
import {
  pickSchedule,
  shownSchedule,
  useSchedulePick,
} from "./useSchedulePick";
import { useSchedules } from "./useSchedules";
// The page and its card borrow Pull requests' head and Settings' rows.
import "../pulls/pull-requests.css";
import "../settings/settings.css";
import "./schedules.css";

export function SchedulesTitle({ onBack }: { onBack: () => void }) {
  return (
    <div className="project-window-title">
      <IconButton label="Back" onClick={onBack}>
        <ArrowLeft size={15} />
      </IconButton>
      <strong>Schedules</strong>
    </div>
  );
}

/** A new one starts paused and empty; writing its prompt turns it on. */
function blank(projectId: string | undefined): ScheduleInput {
  return {
    name: "New schedule",
    projectId: projectId ?? SCRATCHPAD_SCHEDULE,
    prompt: "",
    repeat: "weekly",
    days: [new Date().getDay() === 0 ? 6 : new Date().getDay() - 1],
    time: "09:00",
    freshChat: true,
    workspace: "worktree",
    agent: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "auto-accept-edits",
    tokenLimit: 150_000,
    enabled: false,
  };
}

/** An example filled in, still paused so it runs only once you've looked it over. */
function fromTemplate(
  t: ScheduleTemplate,
  projectId: string | undefined,
): ScheduleInput {
  const base = blank(projectId);
  const { name, prompt, repeat, monthDay, time, workspace, runtimeMode } = t;
  const days = t.days.length ? t.days : base.days;
  return {
    ...base,
    name,
    prompt,
    repeat,
    days,
    monthDay,
    time,
    workspace,
    runtimeMode,
  };
}

export function SchedulesPage({
  projects,
  projectId,
  onOpenChat,
}: {
  projects: Project[];
  /** The project open when the page was, which a new schedule starts in. */
  projectId?: string;
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  const pick = useSchedulePick();
  const schedules = useSchedules();
  const [error, setError] = useState<unknown>();
  const shown = shownSchedule(schedules.data ?? [], pick);
  const real = projects.filter((p) => !p.scratch && !p.removed && !p.computer);
  const startIn = real.some((p) => p.id === projectId)
    ? projectId
    : real[0]?.id;

  async function add(template?: ScheduleTemplate) {
    try {
      const input = template ? fromTemplate(template, startIn) : blank(startIn);
      const made = await api.saveSchedule(null, input);
      pickSchedule(made.id);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="pulls-page schedules-page">
      {!!(error || schedules.error) && (
        <ErrorBox error={error ?? schedules.error} />
      )}
      {schedules.isPending ? (
        <Loading />
      ) : shown ? (
        <ScheduleEditor
          key={shown.id}
          schedule={shown}
          projects={projects}
          onOpenChat={onOpenChat}
          onDeleted={() => pickSchedule(undefined)}
        />
      ) : (
        <>
          <header className="pulls-head">
            <div className="pulls-head-text">
              <div className="pulls-heading">
                <h1>New schedule</h1>
              </div>
              <p>
                Prompts Relay sends on its own. Their runs show up as normal
                threads.
              </p>
            </div>
          </header>
          <ScheduleGallery onPick={(t) => void add(t)} />
        </>
      )}
    </div>
  );
}
