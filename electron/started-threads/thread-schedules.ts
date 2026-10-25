// The schedule tools an agent sets up schedules with (electron/schedules),
// in the thread the user asked it in. Adding, changing and turning one on
// always asks the user first; it spends their usage while they're away.
import { agentName, type AgentProvider } from "../../shared/agents";
import type { RuntimeMode } from "../../shared/agent-modes";
import type { ProjectChat } from "../../shared/projects";
import {
  nextRun,
  scheduleInputOf,
  scheduleWhenLabel,
  SCRATCHPAD_SCHEDULE,
  type Schedule,
  type ScheduleInput,
} from "../../shared/schedules";
import type { ModelChoice } from "../../shared/settings";
import { sliceWhole } from "../../shared/truncate";
import { scheduleWeekdays, toolText, type RelayToolArgs } from "../relay-mcp";
import { json, localTime } from "./tool-output";

/** What the tools need from Relay's schedules. */
export interface ScheduleTools {
  list(): Schedule[];
  save(id: string | null, input: ScheduleInput, setUpIn?: Schedule["setUpIn"]): Promise<Schedule>;
  remove(id: string): Promise<void>;
  test(id: string): Promise<string>;
  /** A project's name, if it's one of the user's. */
  projectName(id: string): string | undefined;
}

/** What the asking thread runs on, for what a schedule leaves out. */
export interface ScheduleDefaults {
  agent: AgentProvider;
  choice: ModelChoice;
  runtimeMode: RuntimeMode;
}

/** Asks the user in the lead's turn; true when they accept. */
type Ask = (title: string, detail: string) => Promise<boolean>;

const DEFAULT_LIMIT = 150_000;

type Fields = Partial<RelayToolArgs<"add_schedule">>;

const projectLabel = (id: string, name: (id: string) => string | undefined) =>
  id === SCRATCHPAD_SCHEDULE ? "Scratchpad" : (name(id) ?? "a project");

/** The schedule after `fields` change it; `base` is the one changed, or a new one's defaults. */
function applied(base: ScheduleInput, fields: Fields, defaults: ScheduleDefaults): ScheduleInput {
  const agent = fields.agent ?? base.agent;
  const sameAgent = agent === defaults.agent;
  const choice =
    fields.agent && fields.agent !== base.agent
      ? { ...(sameAgent ? defaults.choice : { model: "", fast: false, reasoningEffort: "" as const }) }
      : { ...base.choice };
  if (fields.model !== undefined) choice.model = fields.model;
  if (fields.effort !== undefined) choice.reasoningEffort = fields.effort;
  return {
    ...base,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
    ...(fields.repeat !== undefined ? { repeat: fields.repeat } : {}),
    ...(fields.days ? { days: fields.days.map((d) => scheduleWeekdays.indexOf(d)) } : {}),
    ...(fields.day_of_month !== undefined ? { monthDay: fields.day_of_month } : {}),
    ...(fields.time !== undefined ? { time: fields.time } : {}),
    ...(fields.project !== undefined ? { projectId: fields.project } : {}),
    ...(fields.new_chat_each_run !== undefined ? { freshChat: fields.new_chat_each_run } : {}),
    ...(fields.worktree !== undefined ? { workspace: fields.worktree ? "worktree" : "checkout" } : {}),
    ...(fields.token_limit !== undefined ? { tokenLimit: fields.token_limit } : {}),
    agent,
    choice,
  };
}

/** What the user is asked to confirm: everything that runs, in their words. */
function described(s: ScheduleInput, name: (id: string) => string | undefined) {
  const model = s.choice.model ? ` (${s.choice.model}${s.choice.reasoningEffort ? `, ${s.choice.reasoningEffort}` : ""})` : "";
  const prompt = s.prompt.length > 600 ? `${sliceWhole(s.prompt, 0, 600)}…` : s.prompt;
  return [
    `${scheduleWhenLabel(s)}, in ${projectLabel(s.projectId, name)}, while Relay runs on this computer.`,
    `${agentName(s.agent)}${model}, ${s.freshChat ? "a new chat each run" : "every run in the same thread"}${s.workspace === "worktree" && s.projectId !== SCRATCHPAD_SCHEDULE ? ", in a worktree" : ""}, ${s.tokenLimit ? `stopped after ~${Math.round(s.tokenLimit / 1000)}k tokens` : "no token limit"}.`,
    prompt,
  ].join("\n\n");
}

/** One schedule as list_schedules shows it. */
function listed(s: Schedule, name: (id: string) => string | undefined) {
  return {
    id: s.id,
    name: s.name,
    when: scheduleWhenLabel(s),
    ...(s.enabled ? { nextRun: localTime(nextRun(s, Math.max(s.handledUntil, Date.now()))) } : { paused: true }),
    project: projectLabel(s.projectId, name),
    agent: agentName(s.agent),
    ...(s.choice.model ? { model: s.choice.model } : {}),
    newChatEachRun: s.freshChat,
    tokenLimit: s.tokenLimit,
    prompt: s.prompt,
    lastRuns: s.runs.slice(0, 5).map((r) => ({
      at: localTime(r.at),
      outcome: r.outcome,
      ...(r.summary ? { summary: r.summary } : {}),
      ...(r.chatId ? { thread: r.chatId } : {}),
      ...(r.test ? { test: true } : {}),
    })),
  };
}

export class ThreadSchedules {
  private projectName: (id: string) => string | undefined;

  constructor(private schedules: ScheduleTools) {
    this.projectName = (id) => schedules.projectName(id);
  }

  private find(id: string) {
    const schedule = this.schedules.list().find((s) => s.id === id);
    if (!schedule) throw new Error("There's no such schedule; see list_schedules.");
    return schedule;
  }

  list() {
    return json(this.schedules.list().map((s) => listed(s, this.projectName)));
  }

  async add(lead: ProjectChat, fields: RelayToolArgs<"add_schedule">, defaults: ScheduleDefaults, ask: Ask) {
    const input = applied(
      {
        name: fields.name,
        prompt: fields.prompt,
        repeat: fields.repeat,
        days: [4],
        time: fields.time,
        projectId: lead.projectId,
        freshChat: true,
        workspace: "worktree",
        agent: defaults.agent,
        choice: { ...defaults.choice },
        runtimeMode: defaults.runtimeMode,
        tokenLimit: DEFAULT_LIMIT,
        enabled: true,
      },
      fields,
      defaults,
    );
    if (!(await ask(`Schedule “${input.name}”?`, described(input, this.projectName))))
      return toolText("The user didn't save this schedule. Ask them what they want instead.", true);
    const saved = await this.schedules.save(null, input, { chatId: lead.id, title: lead.title });
    return json({ ...listed(saved, this.projectName), note: "Saved. Offer to try it once with run_schedule." });
  }

  async update(fields: RelayToolArgs<"update_schedule">, defaults: ScheduleDefaults, ask: Ask) {
    const { id, ...changes } = fields;
    const old = this.find(id);
    const input = applied(scheduleInputOf(old), changes, defaults);
    if (!(await ask(`Change “${old.name}”?`, described(input, this.projectName))))
      return toolText("The user kept the schedule as it was. Ask them what they want instead.", true);
    return json(listed(await this.schedules.save(id, input), this.projectName));
  }

  async pause({ id, paused }: RelayToolArgs<"pause_schedule">, ask: Ask) {
    const old = this.find(id);
    if (!paused && !old.enabled && !(await ask(`Turn “${old.name}” back on?`, described(old, this.projectName))))
      return toolText("The user left it paused.", true);
    return json(listed(await this.schedules.save(id, { ...scheduleInputOf(old), enabled: !paused }), this.projectName));
  }

  async remove({ id }: RelayToolArgs<"remove_schedule">) {
    const old = this.find(id);
    await this.schedules.remove(id);
    return toolText(`Removed “${old.name}”. The threads its runs started stay.`);
  }

  async run({ id }: RelayToolArgs<"run_schedule">, ask: Ask) {
    const schedule = this.find(id);
    if (!(await ask(`Test-run “${schedule.name}” now?`, described(schedule, this.projectName))))
      return toolText("The user didn't run it. Ask them what they want instead.", true);
    const thread = await this.schedules.test(id);
    return json({
      thread,
      note: "Running in its own thread. Read it with read_thread once it's done, and tune the prompt with update_schedule if it fell short.",
    });
  }
}
