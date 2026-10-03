import type { ChatPending } from "../../../../shared/projects";

type Task = Extract<ChatPending, { kind: "task" }>;
type Wakeup = Extract<ChatPending, { kind: "wakeup" }>;

const listeners = new Set<() => void>();
/** Hears when any session's background work or wake-ups may have changed. */
export function onClaudePending(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const pendingChanged = () => {
  for (const listener of listeners) listener();
};

/** What a session has running that will start Claude's next turn. */
export class ClaudeWork {
  /** Background work that starts Claude's next turn when it ends, by task id. */
  private tasks = new Map<string, Task>();
  /** Wake-ups Claude scheduled for itself, as of the end of its last turn. */
  private wakeups: Wakeup[] = [];

  /** Replaces the live task set; the SDK sends all of it on every change. */
  track(
    tasks: {
      task_id: string;
      task_type?: string;
      description: string;
      ambient?: boolean;
    }[],
  ) {
    const previous = this.tasks;
    this.tasks = new Map();
    for (const task of tasks)
      // Watchers and housekeeping never wake Claude.
      if (!task.ambient)
        this.tasks.set(task.task_id, {
          kind: "task",
          id: task.task_id,
          description: task.description.slice(0, 300),
          // The SDK sends no start time; the first sighting is close enough.
          since: previous.get(task.task_id)?.since ?? Date.now(),
          ...(agentTask(task.task_type) && { agent: true }),
        });
    pendingChanged();
  }

  /** The wake-ups Claude listed as its turn ended. */
  schedule(input: unknown) {
    const crons =
      input && typeof input === "object" && "session_crons" in input
        ? ((input.session_crons as
            | {
                id: string;
                prompt: string;
                recurring: boolean;
                schedule: string;
              }[]
            | undefined) ?? [])
        : [];
    this.wakeups = crons.slice(0, 20).map((cron) => ({
      kind: "wakeup" as const,
      id: cron.id,
      prompt: cron.prompt.slice(0, 1000),
      recurring: cron.recurring,
      ...(cron.recurring ? {} : { at: wakeupTime(cron.schedule) }),
    }));
    pendingChanged();
  }

  has(taskId: string) {
    return this.tasks.has(taskId);
  }

  /** Whether restarting the session would end anything. */
  get any() {
    return this.tasks.size > 0 || this.wakeups.length > 0;
  }

  list(): ChatPending[] {
    return [...this.tasks.values(), ...this.wakeups];
  }
}

const agentTask = (type?: string) =>
  type === "local_agent" || type === "local_workflow";

/** When a one-shot wake-up fires: its cron pins minute, hour, day and month, in local time. */
export function wakeupTime(schedule: string, now = Date.now()) {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minute, hour, day, month] = fields.slice(0, 4).map(Number);
  if (![minute, hour, day, month].every(Number.isInteger)) return undefined;
  const year = new Date(now).getFullYear();
  const at = new Date(year, month - 1, day, hour, minute).getTime();
  // A date already behind us by more than a day is next year's.
  return at < now - 86_400_000
    ? new Date(year + 1, month - 1, day, hour, minute).getTime()
    : at;
}
