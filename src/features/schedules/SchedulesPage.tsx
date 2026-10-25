// The Schedules page, from the button beside Pull requests: prompts Relay
// sends on its own, the list on the left and the picked one beside it.
import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import type { Project } from "../../../shared/projects";
import {
  SCRATCHPAD_SCHEDULE,
  type Schedule,
  type ScheduleInput,
} from "../../../shared/schedules";
import { api } from "../../lib/api";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { ScheduleEditor } from "./ScheduleEditor";
import { ScheduleGallery } from "./ScheduleGallery";
import { nextAt, ScheduleList } from "./ScheduleList";
import { runTime } from "./schedule-format";
import type { ScheduleTemplate } from "./schedule-templates";
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
function fromTemplate(t: ScheduleTemplate, projectId: string | undefined): ScheduleInput {
  const base = blank(projectId);
  const { name, prompt, repeat, monthDay, time, workspace, runtimeMode } = t;
  const days = t.days.length ? t.days : base.days;
  return { ...base, name, prompt, repeat, days, monthDay, time, workspace, runtimeMode };
}

export function SchedulesPage({
  projects,
  projectId,
  initial,
  onOpenChat,
}: {
  projects: Project[];
  /** The project open when the page was, which a new schedule starts in. */
  projectId?: string;
  /** The schedule to show first, as a run's message links to it. */
  initial?: string;
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  const schedules = useSchedules();
  const [picked, setPicked] = useState(initial);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!initial) return;
    setPicked(initial);
    setChoosing(false);
  }, [initial]);
  const list = schedules.data ?? [];
  const shown = list.find((s) => s.id === picked) ?? list[0];
  const real = projects.filter((p) => !p.scratch && !p.removed && !p.computer);
  const startIn = real.some((p) => p.id === projectId) ? projectId : real[0]?.id;

  async function add(template?: ScheduleTemplate) {
    try {
      const input = template ? fromTemplate(template, startIn) : blank(startIn);
      const made = await api.saveSchedule(null, input);
      setPicked(made.id);
      setChoosing(false);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }

  const galleryShown = choosing || (!schedules.isPending && !shown);

  return (
    <div className="pulls-page schedules-page">
      <SchedulesHead
        schedules={list}
        onNew={galleryShown ? undefined : () => setChoosing(true)}
      />
      {!!(error || schedules.error) && <ErrorBox error={error ?? schedules.error} />}
      {schedules.isPending ? (
        <Loading />
      ) : !shown ? (
        <ScheduleGallery onPick={(t) => void add(t)} />
      ) : (
        <div className="schedules-body">
          <ScheduleList
            schedules={list}
            projects={projects}
            picked={choosing ? undefined : shown.id}
            onPick={(id) => {
              setPicked(id);
              setChoosing(false);
            }}
          />
          {choosing ? (
            <ScheduleGallery onPick={(t) => void add(t)} />
          ) : (
            <ScheduleEditor
              key={shown.id}
              schedule={shown}
              projects={projects}
              onOpenChat={onOpenChat}
              onDeleted={() => setPicked(undefined)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The title, what runs next, and New schedule unless the examples are already showing. */
function SchedulesHead({
  schedules,
  onNew,
}: {
  schedules: Schedule[];
  onNew?: () => void;
}) {
  const on = schedules.filter((s) => s.enabled);
  const soonest = on.length
    ? on.reduce((a, b) => (nextAt(a) <= nextAt(b) ? a : b))
    : undefined;
  return (
    <header className="pulls-head">
      <div className="pulls-head-text">
        <div className="pulls-heading">
          <h1>Schedules</h1>
        </div>
        <p>
          {soonest ? (
            <>
              {on.length} running on their own · next up <strong>{soonest.name}</strong>,{" "}
              {runTime(nextAt(soonest))}
            </>
          ) : (
            "Prompts Relay sends on its own. Their runs show up as normal threads."
          )}
        </p>
      </div>
      {onNew && (
        <div className="pulls-tools">
          <button className="pulls-quiet-button" onClick={onNew}>
            <Plus size={14} /> New schedule
          </button>
        </div>
      )}
    </header>
  );
}
