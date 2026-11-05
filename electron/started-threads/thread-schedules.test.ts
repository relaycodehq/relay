import { expect, test, vi } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { Schedule } from "../../shared/schedules";
import { resultText } from "../relay-mcp";
import { AgentChoices, type ThreadAgents } from "./thread-agents";
import {
  ThreadSchedules,
  type ScheduleDefaults,
  type ScheduleTools,
} from "./thread-schedules";

const agents: ThreadAgents = {
  cantRun: (agent) =>
    agent === "cursor"
      ? "Cursor is switched off in Settings → Agents."
      : undefined,
  models: async () => [],
};

const defaults: ScheduleDefaults = {
  agent: "claude",
  choice: { model: "", fast: false, reasoningEffort: "" },
  runtimeMode: "auto-accept-edits",
};

const lead = { id: "lead", projectId: "p", title: "Lead" } as ProjectChat;

const existing = {
  id: "s1",
  name: "Changelog",
  prompt: "Write the changelog",
  repeat: "weekly",
  days: [4],
  time: "09:00",
  projectId: "p",
  freshChat: true,
  workspace: "worktree",
  agent: "claude",
  choice: defaults.choice,
  runtimeMode: defaults.runtimeMode,
  tokenLimit: 150_000,
  enabled: true,
  runs: [],
} as unknown as Schedule;

function schedulesWith() {
  const tools: ScheduleTools = {
    list: () => [existing],
    save: vi.fn(async (id, input) => ({
      ...existing,
      ...input,
      id: id ?? "s2",
    })),
    remove: vi.fn(),
    test: vi.fn(),
    projectName: () => "Relay",
  };
  const choices = new AgentChoices(agents);
  return { tools, choices, schedules: new ThreadSchedules(tools, choices) };
}

test("a schedule on an agent that can't run here is refused as start_threads refuses it", async () => {
  const { tools, choices, schedules } = schedulesWith();
  const ask = vi.fn(async () => true);
  const refusal = await choices.refusal([{ agent: "cursor" }], defaults.agent);
  expect(refusal).toContain("Cursor is switched off in Settings → Agents.");

  const added = await schedules.add(
    lead,
    {
      name: "Changelog",
      prompt: "Write it",
      repeat: "daily",
      time: "09:00",
      agent: "cursor",
    },
    defaults,
    ask,
  );
  expect(added).toMatchObject({ isError: true });
  expect(resultText(added)).toBe(refusal);

  const updated = await schedules.update(
    { id: "s1", agent: "cursor" },
    defaults,
    ask,
  );
  expect(updated).toMatchObject({ isError: true });
  expect(resultText(updated)).toBe(refusal);

  expect(ask).not.toHaveBeenCalled();
  expect(tools.save).not.toHaveBeenCalled();
});

test("a schedule on an agent that can run, or naming none, still goes to the user", async () => {
  const { tools, schedules } = schedulesWith();
  const ask = vi.fn(async () => true);
  await schedules.add(
    lead,
    { name: "Changelog", prompt: "Write it", repeat: "daily", time: "09:00" },
    defaults,
    ask,
  );
  await schedules.update({ id: "s1", agent: "codex" }, defaults, ask);
  await schedules.update({ id: "s1", time: "10:00" }, defaults, ask);
  expect(ask).toHaveBeenCalledTimes(3);
  expect(tools.save).toHaveBeenCalledTimes(3);
});

test("a schedule naming a model its agent doesn't offer is refused before the user is asked", async () => {
  const { tools } = schedulesWith();
  const choices = new AgentChoices({
    ...agents,
    models: async () => [{ id: "opus", name: "Opus" }] as never,
  });
  const schedules = new ThreadSchedules(tools, choices);
  const ask = vi.fn(async () => true);

  const updated = await schedules.update(
    { id: "s1", model: "opsu" },
    defaults,
    ask,
  );
  expect(updated).toMatchObject({ isError: true });
  expect(resultText(updated)).toContain("has no model opsu");

  const added = await schedules.add(
    lead,
    {
      name: "Changelog",
      prompt: "Write it",
      repeat: "daily",
      time: "09:00",
      model: "opus",
    },
    defaults,
    ask,
  );
  expect(added).not.toMatchObject({ isError: true });
  expect(ask).toHaveBeenCalledOnce();
});
