import { afterEach, expect, it, vi } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ProjectTask } from "../../shared/tasks";
import { projectTasks } from "../terminal/tasks";
import { PreviewProjects, worktreeDevPort } from "./projects";
import * as runningServers from "./running-server";
import type { SavedPreview } from "./saved-previews";

vi.mock("../git/git", () => ({
  currentBranchOr: async (folder: string) => folder.split("/").at(-1),
}));
afterEach(() => vi.restoreAllMocks());

function setup(
  chat: Partial<ProjectChat>,
  listeners: Record<string, number[]>,
  devPort = 3000,
) {
  const own = { id: "one", projectId: "project", ...chat } as ProjectChat;
  const tasks = Object.entries(listeners).map(
    ([folder, ports]) => ({ folder, ports }) as ProjectTask,
  );
  const scan = vi.spyOn(projectTasks, "list").mockResolvedValue(tasks);
  const settings = { devPort, devCommand: "npm run dev" };
  const terminalFolder = vi.fn(async () => own.worktree?.path ?? "/repo");
  vi.spyOn(runningServers, "runningServerPorts").mockImplementation(
    async (tasks) => tasks.flatMap((t) => t.ports),
  );
  const resolver = new PreviewProjects(
    {
      root: async () => "/repo",
      get: () =>
        ({
          path: "/repo",
          settings,
        }) as never,
    },
    {
      get: async (id) => ({ ...own, id }),
      terminalFolder,
      worktreeEnv: async () => ({ RELAY_PORT_OFFSET: "10" }),
      worktreeFolders: () => [{ path: "/repo/neighbour", chatId: "other" }],
    },
    () => [],
  );
  return { resolver, scan, settings, terminalFolder };
}

it("gives checkout threads their own storage while retaining the checkout as the cookie seed", async () => {
  const { resolver } = setup({}, { "/repo": [3000] });
  const a = await resolver.target("project", "one", undefined);
  const b = await resolver.target("project", "two", undefined);
  const draft = await resolver.target("project", null, undefined);
  expect(a.partition).toBe("persist:thread-one");
  expect(b.partition).toBe("persist:thread-two");
  expect(a.checkoutPartition).toBe(draft.partition);
  expect(a.dev).toEqual({ port: 3000, command: "npm run dev" });
});

it("selects an agent-created worktree ahead of the checkout and ignores neighbours", async () => {
  const { resolver, scan } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    { "/repo": [3000], "/repo/manual": [5173], "/repo/neighbour": [8080] },
  );
  const target = await resolver.target("project", "one", undefined);
  expect(target).toMatchObject({
    folder: "/repo/manual",
    branch: "manual",
    worktree: "manual",
    dev: { port: 5173 },
    partition: "persist:thread-one",
  });
  expect(target.dev?.command).toBeUndefined();
  expect(target.env).toMatchObject({
    RELAY_WORKTREE: "/repo/manual",
    RELAY_PROJECT_ROOT: "/repo",
  });
  expect(scan.mock.calls[0]![1]).toContainEqual({
    path: "/repo/manual",
    chatId: "one",
  });
});

it("requires an explicit URL between two live agent worktrees and selects its owner", async () => {
  const { resolver } = setup(
    {
      agentWorktrees: [
        { path: "/repo/a", branch: "a", at: 1 },
        { path: "/repo/b", branch: "b", at: 1 },
      ],
    },
    { "/repo/a": [5173], "/repo/b": [8080] },
  );
  await expect(resolver.target("project", "one", undefined)).rejects.toThrow(
    "Several",
  );
  expect(
    await resolver.target("project", "one", "http://localhost:8080/settings"),
  ).toMatchObject({ folder: "/repo/b", worktree: "b", dev: { port: 8080 } });
  expect(
    await resolver.target("project", "one", undefined, "/repo/b"),
  ).toMatchObject({ folder: "/repo/b" });
});

it("retains the managed worktree and its saved port offset", async () => {
  const { resolver } = setup(
    {
      worktree: {
        path: "/repo/managed",
        branch: "managed",
      } as ProjectChat["worktree"],
    },
    { "/repo": [3000], "/repo/managed": [3010] },
  );
  expect(await resolver.target("project", "one", undefined)).toMatchObject({
    folder: "/repo/managed",
    partition: "persist:thread-one",
    dev: { port: 3010, command: "npm run dev" },
  });
});

it("does not load the checkout's configured port when a manual worktree has several services", async () => {
  const { resolver } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    { "/repo": [3000], "/repo/manual": [5173, 8080] },
  );
  const target = await resolver.target("project", "one", undefined);
  expect(target.folder).toBe("/repo/manual");
  expect(target.dev).toBeUndefined();
});

it("validates worktree offsets before returning a configured dev target", async () => {
  expect(() => worktreeDevPort(65530, { RELAY_PORT_OFFSET: "10" })).toThrow(
    "between 1 and 65535",
  );
  expect(() => worktreeDevPort(1, { RELAY_PORT_OFFSET: "-10" })).toThrow(
    "between 1 and 65535",
  );
  expect(() => worktreeDevPort(3000, { RELAY_PORT_OFFSET: "0.5" })).toThrow(
    "between 1 and 65535",
  );
  expect(worktreeDevPort(65525, { RELAY_PORT_OFFSET: "10" })).toBe(65535);
});

it("opens an explicit remote page even when local worktree selection is ambiguous", async () => {
  const { resolver, scan, terminalFolder } = setup(
    {
      agentWorktrees: [
        { path: "/repo/a", branch: "a", at: 1 },
        { path: "/repo/b", branch: "b", at: 1 },
      ],
    },
    { "/repo/a": [5173], "/repo/b": [8080] },
  );
  scan.mockRejectedValue(new Error("Process discovery is unavailable"));
  const target = await resolver.target(
    "project",
    "one",
    "https://example.com/",
  );
  expect(target.folder).toBe("/repo");
  expect(target.dev).toBeUndefined();
  expect(terminalFolder).toHaveBeenCalledWith("project", "one");
  expect(scan).not.toHaveBeenCalled();
  expect(runningServers.runningServerPorts).not.toHaveBeenCalled();

  await expect(
    resolver.target("project", "one", "https://example.com/", "/removed"),
  ).rejects.toThrow("no longer part of this thread");
  terminalFolder.mockRejectedValueOnce(
    new Error("Selected workspace is unavailable"),
  );
  await expect(
    resolver.target("project", "one", "https://example.com/"),
  ).rejects.toThrow("Selected workspace is unavailable");
  expect(scan).not.toHaveBeenCalled();
});

it("rejects an overflowing configured port during target resolution", async () => {
  const { resolver } = setup(
    {
      worktree: {
        path: "/repo/managed",
        branch: "managed",
      } as ProjectChat["worktree"],
    },
    {},
    65530,
  );
  await expect(resolver.target("project", "one", undefined)).rejects.toThrow(
    "dev port 65530 plus worktree offset 10",
  );
});

const remembered: SavedPreview = {
  projectId: "project",
  folder: "/repo/manual",
  url: "http://localhost:5173/previews/example/?q=one#two",
  dev: { port: 5173, command: "npm run dev -- --port 5173" },
  settings: { devPort: 3000, devCommand: "npm run dev" },
};

it("recovers a stopped manual worktree server using its saved folder and command", async () => {
  const { resolver } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    { "/repo": [3000] },
  );
  expect(
    await resolver.target(
      "project",
      "one",
      remembered.url,
      remembered.folder,
      remembered,
    ),
  ).toMatchObject({
    folder: remembered.folder,
    url: remembered.url,
    dev: remembered.dev,
  });
});

it("rejects a removed preview folder and a saved port now owned by another worktree", async () => {
  const removed = setup({}, {});
  await expect(
    removed.resolver.target(
      "project",
      "one",
      remembered.url,
      remembered.folder,
      remembered,
    ),
  ).rejects.toThrow("no longer part of this thread");
  const conflict = setup(
    {
      agentWorktrees: [
        { path: "/repo/manual", branch: "manual", at: 1 },
        { path: "/repo/other", branch: "other", at: 1 },
      ],
    },
    { "/repo/other": [5173] },
  );
  await expect(
    conflict.resolver.target(
      "project",
      "one",
      remembered.url,
      remembered.folder,
      remembered,
    ),
  ).rejects.toThrow("another worktree");
});

it("uses changed project settings instead of resurrecting an old command", async () => {
  const { resolver, settings } = setup({}, {});
  const saved: SavedPreview = {
    ...remembered,
    folder: "/repo",
    url: "http://localhost:3000/settings?q=one#two",
    dev: { port: 3000, command: "old command" },
  };
  settings.devCommand = "new command";
  settings.devPort = 4000;
  expect(
    await resolver.target("project", "one", saved.url, saved.folder, saved),
  ).toMatchObject({
    url: "http://localhost:4000/settings?q=one#two",
    dev: { port: 4000, command: "new command" },
  });
});

it("does not reuse another service's saved command for a new URL", async () => {
  const { resolver } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    {},
  );
  const result = await resolver.target(
    "project",
    "one",
    "http://localhost:8080/",
    remembered.folder,
    remembered,
  );
  expect(result.dev).toEqual({ port: 8080 });
});
