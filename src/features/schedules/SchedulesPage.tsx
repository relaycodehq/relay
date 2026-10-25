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
import { nextAt, ScheduleList } from "./ScheduleList";
import { runTime } from "./schedule-format";
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
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (initial) setPicked(initial);
  }, [initial]);
  const list = schedules.data ?? [];
  const shown = list.find((s) => s.id === picked) ?? list[0];
  const real = projects.filter((p) => !p.scratch && !p.removed && !p.computer);
  const startIn = real.some((p) => p.id === projectId) ? projectId : real[0]?.id;

  async function add() {
    try {
      const made = await api.saveSchedule(null, blank(startIn));
      setPicked(made.id);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="pulls-page schedules-page">
      <SchedulesHead schedules={list} onNew={() => void add()} />
      {!!(error || schedules.error) && <ErrorBox error={error ?? schedules.error} />}
      {schedules.isPending ? (
        <Loading />
      ) : !shown ? (
        <div className="schedules-empty">
          <p>
            Run a prompt on its own every day, week or month: draft the changelog on Fridays,
            triage new pull requests each morning.
          </p>
          <p>
            Make one here, or ask an agent in any thread, like “every Friday at 9, draft the
            changelog”.
          </p>
          <button className="primary" onClick={() => void add()}>
            <Plus size={14} /> New schedule
          </button>
        </div>
      ) : (
        <div className="schedules-body">
          <ScheduleList
            schedules={list}
            projects={projects}
            picked={shown.id}
            onPick={setPicked}
          />
          <ScheduleEditor
            key={shown.id}
            schedule={shown}
            projects={projects}
            onOpenChat={onOpenChat}
            onDeleted={() => setPicked(undefined)}
          />
        </div>
      )}
    </div>
  );
}

/** The title, what runs next, and New schedule. */
function SchedulesHead({
  schedules,
  onNew,
}: {
  schedules: Schedule[];
  onNew: () => void;
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
      <div className="pulls-tools">
        <button className="pulls-quiet-button" onClick={onNew}>
          <Plus size={14} /> New schedule
        </button>
      </div>
    </header>
  );
}
