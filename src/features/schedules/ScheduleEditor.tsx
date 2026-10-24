// One schedule on the Schedules page: its prompt in the real composer, whose
// agent, model and effort it runs with, the card of when and how, and the
// runs it left. What's changed saves a moment later, as Settings does.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Folder, FolderGit2, Play, Trash2 } from "lucide-react";
import type { Project } from "../../../shared/projects";
import {
  nextRuns,
  scheduleInputOf,
  SCRATCHPAD_SCHEDULE,
  type Schedule,
  type ScheduleInput,
} from "../../../shared/schedules";
import type { ComposedSend } from "../../../shared/compose-send";
import { api } from "../../lib/api";
import { scheduleDraftKey } from "../../lib/thread-storage";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { SearchSelect } from "../../ui/SearchSelect";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "../../ui/SettingsCard";
import { ErrorBox, IconButton, Spinner } from "../../ui/ui";
import {
  ProjectComposer,
  type ComposerHandle,
} from "../composer/ProjectComposer";
import { readDraft, useDraft, writeDraft } from "../composer/drafts";
import { ProjectBadge } from "../projects/ProjectBadge";
import { RepeatPicker } from "./RepeatPicker";
import { nextAt, scheduleProject, scratchpadProject } from "./ScheduleList";
import { dayMonth, runTime, tokenCount } from "./schedule-format";

const SAVE_AFTER_MS = 400;
/** How often the composer's agent and model are read back, having no event of their own. */
const SETTINGS_POLL_MS = 1500;

const limits = [
  { value: "50000", label: "~50k tokens" },
  { value: "150000", label: "~150k tokens" },
  { value: "400000", label: "~400k tokens" },
  { value: "1000000", label: "~1M tokens" },
  { value: "0", label: "No limit" },
];

const sameSettings = (a: ScheduleInput, b: Pick<ScheduleInput, "agent" | "choice" | "runtimeMode">) =>
  a.agent === b.agent &&
  a.runtimeMode === b.runtimeMode &&
  JSON.stringify(a.choice) === JSON.stringify(b.choice);

export function ScheduleEditor({
  schedule,
  projects,
  onOpenChat,
  onDeleted,
}: {
  schedule: Schedule;
  projects: Project[];
  onOpenChat: (projectId: string, chatId: string) => void;
  onDeleted: () => void;
}) {
  const key = scheduleDraftKey(schedule.id);
  const composer = useRef<ComposerHandle>(null);
  const [form, setForm] = useState(() => scheduleInputOf(schedule));
  const formRef = useRef(form);
  formRef.current = form;
  const [error, setError] = useState<unknown>();
  const [testing, setTesting] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saved = useRef(JSON.stringify(scheduleInputOf(schedule)));

  const save = (next: ScheduleInput) => {
    clearTimeout(pending.current);
    pending.current = undefined;
    saved.current = JSON.stringify(next);
    return api.saveSchedule(schedule.id, next).then(
      () => setError(undefined),
      (e: unknown) => setError(e),
    );
  };
  const change = (patch: Partial<ScheduleInput>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(next), SAVE_AFTER_MS);
  };
  // What's still waiting goes out as the page is left.
  useEffect(
    () => () => {
      if (pending.current) void save(formRef.current);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Changed elsewhere, by an agent or another window, while nothing waits to save here.
  useEffect(() => {
    const theirs = JSON.stringify(scheduleInputOf(schedule));
    if (pending.current || theirs === saved.current) return;
    saved.current = theirs;
    setForm(scheduleInputOf(schedule));
    if (readDraft(key) !== schedule.prompt) writeDraft(key, schedule.prompt);
  }, [schedule, key]);

  // The schedule keeps the prompt; the composer's draft only mirrors it.
  useLayoutEffect(() => {
    if (readDraft(key) !== schedule.prompt) writeDraft(key, schedule.prompt);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useDraft(key);
  const seeded = useRef(false);
  useEffect(() => {
    // The first look is from before the draft was seeded.
    if (!seeded.current) {
      seeded.current = true;
      return;
    }
    if (text === formRef.current.prompt) return;
    // A new one turns on once it has something to do.
    const first = !schedule.runs.length && !formRef.current.prompt.trim() && !!text.trim();
    change({ prompt: text, ...(first ? { enabled: true } : {}) });
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      const picked = composer.current?.agentSettings();
      if (!picked) return;
      const next = { agent: picked.provider, choice: picked.choice, runtimeMode: picked.runtimeMode };
      if (!sameSettings(formRef.current, next)) change(next);
    }, SETTINGS_POLL_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function test(sent?: ComposedSend) {
    setTesting(true);
    try {
      const picked = sent
        ? { agent: sent.provider, choice: sent.choice, runtimeMode: sent.runtimeMode }
        : {};
      const next = { ...formRef.current, ...picked };
      formRef.current = next;
      setForm(next);
      await api.saveSchedule(schedule.id, next);
      saved.current = JSON.stringify(next);
      clearTimeout(pending.current);
      pending.current = undefined;
      await api.testSchedule(schedule.id);
      setError(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setTesting(false);
    }
  }

  const scratch = form.projectId === SCRATCHPAD_SCHEDULE;
  const [first, ...later] = nextRuns(form, Math.max(schedule.handledUntil, Date.now() - 1), 3);
  // The Scratchpad has no project of its own until a run makes one.
  const composerProject = scratch
    ? (projects.find((p) => p.scratch) ?? projects[0])?.id
    : form.projectId;

  return (
    <section className="schedule-editor" aria-label={form.name}>
      <div className="schedule-editor-head">
        <input
          className="schedule-name"
          aria-label="Name"
          value={form.name}
          maxLength={120}
          onChange={(e) => e.target.value.trim() && change({ name: e.target.value })}
        />
        <DeleteButton
          onDelete={() =>
            void api.deleteSchedule(schedule.id).then(onDeleted, setError)
          }
        />
        <label className="schedule-switch" title={form.enabled ? "Pause it" : "Turn it on"}>
          <Switch
            label="On"
            checked={form.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          {form.enabled ? "On" : "Paused"}
        </label>
      </div>
      {!!error && <ErrorBox error={error} />}
      <div className="schedule-prompt">
        {composerProject && (
          <ProjectComposer
            key={schedule.id}
            ref={composer}
            projectId={composerProject}
            keys={{ draft: key, settings: `schedule:${schedule.id}` }}
            conversation={{
              running: false,
              busy: testing,
              agent: schedule.agent,
              lastSent: {
                id: schedule.id,
                provider: schedule.agent,
                choice: schedule.choice,
                runtimeMode: schedule.runtimeMode,
                interactionMode: "default",
              },
            }}
            placeholder="What should it do each time? Skills and @files work here."
            context={
              <WhereControls
                form={form}
                projects={projects}
                onChange={change}
              />
            }
            below={<span className="schedule-hint">↵ runs a test</span>}
            onSend={async (sent) => {
              await test(sent);
              return false;
            }}
            onCommand={() => false}
          />
        )}
      </div>
      <SettingsCard>
        <SettingsRow
          label="Repeat"
          hint={
            form.enabled ? (
              <>
                Next <strong>{runTime(first)}</strong>, then {later.map(dayMonth).join(" and ")}
              </>
            ) : (
              "Paused, so it doesn't run"
            )
          }
        >
          <RepeatPicker
            value={form}
            onChange={({ repeat, days, monthDay, time }) =>
              change({ repeat, days, monthDay, time })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Start each run in a new chat"
          hint={
            form.freshChat
              ? "Every run is its own thread."
              : "Runs add to one thread, so it remembers the last one."
          }
        >
          <Switch
            label="Start each run in a new chat"
            checked={form.freshChat}
            onChange={(freshChat) => change({ freshChat })}
          />
        </SettingsRow>
        <SettingsRow
          label="Token limit per run"
          hint="Relay stops a run that uses more, counted from what its agent reports."
        >
          <div className="composer-tools model-field">
            <ComposerSelect
              label="Token limit per run"
              value={limits.some((l) => l.value === String(form.tokenLimit)) ? String(form.tokenLimit) : "150000"}
              options={limits}
              onChange={(v) => change({ tokenLimit: Number(v) })}
            />
          </div>
        </SettingsRow>
        <SettingsFooter note="Runs while Relay runs on this computer.">
          <button
            type="button"
            className="schedule-test"
            disabled={testing || !form.prompt.trim()}
            onClick={() => void test()}
          >
            {testing ? <Spinner size={12} /> : <Play size={12} />} Test run
          </button>
        </SettingsFooter>
      </SettingsCard>
      <Runs schedule={schedule} onOpenChat={onOpenChat} />
    </section>
  );
}

/** Above the prompt, as on a new thread: which project it runs in, and where in it. */
function WhereControls({
  form,
  projects,
  onChange,
}: {
  form: ScheduleInput;
  projects: Project[];
  onChange: (patch: Partial<ScheduleInput>) => void;
}) {
  const scratch = form.projectId === SCRATCHPAD_SCHEDULE;
  const choices = [scratchpadProject, ...projects.filter((p) => !p.scratch && !p.removed && !p.computer)];
  const project = scheduleProject(form, projects);
  return (
    <>
      <SearchSelect
        label="Project"
        placeholder="Search projects…"
        triggerClassName="composer-branch-trigger schedule-project"
        triggerLabel="Project"
        trigger={
          <>
            <ProjectBadge project={project} />
            <span>{project?.name ?? "Removed project"}</span>
            <ChevronDown size={12} />
          </>
        }
        value={form.projectId}
        options={choices.map((p) => ({
          value: p.id,
          label: p.name,
          detail: p.scratch ? "no project, a chat on its own" : undefined,
          icon: <ProjectBadge project={p} />,
        }))}
        onChange={(projectId) => onChange({ projectId })}
      />
      {!scratch && (
        <ComposerSelect
          label="Works in"
          className="composer-branch-trigger"
          icon={form.workspace === "worktree" ? <FolderGit2 size={13} /> : <Folder size={13} />}
          value={form.workspace}
          options={[
            {
              value: "worktree",
              label: "New worktree each run",
              description: "Runs never trip over your changes",
            },
            {
              value: "checkout",
              label: "Project folder",
              description: "Works on what's checked out",
            },
          ]}
          onChange={(workspace) => onChange({ workspace })}
        />
      )}
    </>
  );
}

/** Delete, then a moment to take it back by not pressing again. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return armed ? (
    <button type="button" className="text-button schedule-delete" onClick={onDelete}>
      Delete it and its runs
    </button>
  ) : (
    <IconButton label="Delete schedule" onClick={() => setArmed(true)}>
      <Trash2 size={14} />
    </IconButton>
  );
}

function Runs({
  schedule,
  onOpenChat,
}: {
  schedule: Schedule;
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  if (!schedule.runs.length)
    return (
      <p className="schedule-runs-empty">
        {schedule.enabled
          ? `Its first run is ${runTime(nextAt(schedule))}. Runs show up here and as threads.`
          : "No runs yet. Test run tries it now."}
      </p>
    );
  return (
    <>
      <h2 className="schedule-runs-title">Runs</h2>
      <ol className="schedule-runs">
        {schedule.runs.map((run) => (
          <li key={run.id} data-outcome={run.outcome}>
            <time>{runTime(run.at)}</time>
            <span className="schedule-run-summary">
              {run.outcome === "running" && <Spinner size={11} />}
              {run.test && <span className="schedule-run-test">Test</span>}
              {run.outcome === "running" ? "Running…" : run.summary}
            </span>
            <small>{run.tokens ? `${tokenCount(run.tokens)} tokens` : ""}</small>
            {run.chatId && run.projectId ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onOpenChat(run.projectId!, run.chatId!)}
              >
                Open
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
