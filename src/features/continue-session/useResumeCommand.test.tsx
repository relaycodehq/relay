// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CommandOption } from "../../../shared/commands";
import type { Project } from "../../../shared/projects";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { api } from "../../lib/api";
import { useResumeCommand } from "./useResumeCommand";

vi.mock("../../lib/api", () => ({ api: { terminalSessions: vi.fn() } }));

const listed = vi.mocked(api.terminalSessions);

const here: Project = {
  id: "p1",
  name: "Sample",
  path: "/tmp/sample",
} as Project;

const remote: Project = {
  ...here,
  computer: { id: "c1", name: "remote-computer", projectId: "p9" },
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let shown: CommandOption[] = [];
let resume: ReturnType<typeof useResumeCommand>;

/** Asks for the `/resume` options on every render, as the composer's menu does. */
function Menu({
  project,
  workspace,
}: {
  project: Project;
  workspace: "checkout" | "worktree";
}) {
  resume = useResumeCommand({
    project,
    settingsKey: "t1",
    workspace,
    onContinued: async () => {},
    onOpenThread: async () => {},
    onError: () => {},
  });
  shown = resume.options("resume", "") ?? [];
  return null;
}

async function open(
  project: Project,
  workspace: "checkout" | "worktree" = "checkout",
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Menu project={project} workspace={workspace} />
      </QueryClientProvider>,
    );
  });
  // Lets a failed lookup land and any re-render it causes run.
  for (let i = 0; i < 5; i++)
    await act(() => new Promise((r) => setTimeout(r)));
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  shown = [];
  listed.mockReset();
});

afterEach(() => act(() => root.unmount()));

it("says the lookup failed instead of looking forever, and asks once", async () => {
  listed.mockRejectedValue(new Error("Couldn't read the sessions folder"));
  await open(here);
  expect(listed).toHaveBeenCalledTimes(1);
  expect(shown.map((o) => o.label)).toEqual(["Couldn't look for sessions"]);
  expect(shown[0].description).toBe("Couldn't read the sessions folder");
});

it("lists a project's sessions on its own computer, which a worktree here can't continue", async () => {
  listed.mockResolvedValue([
    {
      provider: "codex",
      id: "0199aaaa-bbbb",
      title: "Fix the login",
      updated: Date.now(),
      turns: 3,
    } as TerminalSession,
  ]);
  await open(remote);
  expect(listed).toHaveBeenCalledWith("p1");
  expect(shown[0].description).toMatch(/^Runs on remote-computer · Codex/);
  await open(remote, "worktree");
  expect(resume.command("resume", "codex:0199aaaa-bbbb")).toBe(
    "A session on remote-computer goes on in its checkout: pick Current checkout first.",
  );
});
