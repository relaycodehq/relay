import { expect, it, vi } from "vitest";
import type { ProjectChatSend } from "../../shared/projects";
import { findExecutable } from "../platform/executables";
import { SetupAgents } from "./setup-agent";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

const settings = {
  provider: "codex" as const,
  choice: {
    model: "gpt-5.5-codex",
    fast: false,
    reasoningEffort: "high" as const,
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

/** Starts a setup on a computer with only `installed` agents; what its thread was sent. */
async function started(installed: string[]) {
  vi.mocked(findExecutable).mockImplementation(async (name) => {
    if (!installed.includes(name)) throw new Error("not installed");
    return `/bin/${name}`;
  });
  const sent: ProjectChatSend[] = [];
  const agents = new SetupAgents({
    handedOver: () => undefined,
    adoptSetup: async (_project, _title, _from, input) => sent.push(input),
    scratch: async () => ({ id: "scratch" }),
    defaultFolder: async () => "/tmp",
    addAt: async () => {
      throw new Error("not here");
    },
    projects: async () => [],
  });
  await agents.start(
    "11111111-1111-4111-8111-111111111111",
    {
      url: "https://github.com/me/app.git",
      repositories: ["me/app"],
      error: "fatal: nope",
      settings,
    },
    { id: "laptop", name: "Laptop" },
  );
  return sent;
}

it("sets up with the thread's own agent when it's installed there, else one that is, on its default model", async () => {
  expect((await started(["codex", "claude"]))[0]).toMatchObject({
    provider: "codex",
    choice: settings.choice,
  });
  expect((await started(["claude", "git"]))[0]).toMatchObject({
    provider: "claude",
    to: "claude",
    choice: { model: "", reasoningEffort: "" },
  });
  await expect(started(["git"])).rejects.toThrow(/No agent is installed/);
});
