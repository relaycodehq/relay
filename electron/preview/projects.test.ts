import { afterEach, expect, it, vi } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ProjectTask } from "../../shared/tasks";
import { projectTasks } from "../terminal/tasks";
import { PreviewProjects, worktreeDevPort } from "./projects";
import * as runningServers from "./running-server";
import type { ServerLinks } from "./server-links";

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
  vi.spyOn(runningServers, "runningServerPorts").mockImplementation(
    async (tasks) => tasks.flatMap((t) => t.ports),
  );
  const route = vi.fn(async () => ({
    folder: "/repo",
    project: "repo",
    port: 4000,
    wake: async () => {},
  }));
  const links = { route } as unknown as ServerLinks;
  const resolver = new PreviewProjects(
    {
      root: async () => "/repo",
      get: () =>
        ({
          path: "/repo",
          settings: { devPort, devCommand: "npm run dev" },
        }) as never,
    },
    {
      get: async (id) => ({ ...own, id }),
      terminalFolder: async () => own.worktree?.path ?? "/repo",
      worktreeEnv: async () => ({ RELAY_PORT_OFFSET: "10" }),
      worktreeFolders: () => [{ path: "/repo/neighbour", chatId: "other" }],
    },
    () => [],
  );
  return { resolver, links, route, scan, own };
}

it("gives checkout threads their own storage while retaining the checkout as the cookie seed", async () => {
  const { resolver, links } = setup({}, { "/repo": [3000] });
  const a = await resolver.target("project", "one", undefined, links);
  const b = await resolver.target("project", "two", undefined, links);
  const draft = await resolver.target("project", null, undefined, links);
  expect(a.partition).toBe("persist:thread-one");
  expect(b.partition).toBe("persist:thread-two");
  expect(a.checkoutPartition).toBe(draft.partition);
  expect(a.dev).toEqual({ port: 3000, command: "npm run dev" });
});

it("selects an agent-created worktree ahead of the checkout and ignores neighbours", async () => {
  const { resolver, links, route, scan, own } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    { "/repo": [3000], "/repo/manual": [5173], "/repo/neighbour": [8080] },
  );
  const target = await resolver.target("project", "one", undefined, links);
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
  await target.external(5173);
  expect(route).toHaveBeenCalledWith(own, "/repo/manual", 5173);
  expect(scan.mock.calls[0]![1]).toContainEqual({
    path: "/repo/manual",
    chatId: "one",
  });
});

it("requires an explicit URL between two live agent worktrees and selects its owner", async () => {
  const { resolver, links } = setup(
    {
      agentWorktrees: [
        { path: "/repo/a", branch: "a", at: 1 },
        { path: "/repo/b", branch: "b", at: 1 },
      ],
    },
    { "/repo/a": [5173], "/repo/b": [8080] },
  );
  await expect(
    resolver.target("project", "one", undefined, links),
  ).rejects.toThrow("Several");
  expect(
    await resolver.target(
      "project",
      "one",
      "http://localhost:8080/settings",
      links,
    ),
  ).toMatchObject({ folder: "/repo/b", worktree: "b", dev: { port: 8080 } });
  expect(
    await resolver.target("project", "one", undefined, links, "/repo/b"),
  ).toMatchObject({ folder: "/repo/b" });
});

it("retains the managed worktree and its saved port offset", async () => {
  const { resolver, links } = setup(
    {
      worktree: {
        path: "/repo/managed",
        branch: "managed",
      } as ProjectChat["worktree"],
    },
    { "/repo": [3000], "/repo/managed": [3010] },
  );
  expect(
    await resolver.target("project", "one", undefined, links),
  ).toMatchObject({
    folder: "/repo/managed",
    partition: "persist:thread-one",
    dev: { port: 3010, command: "npm run dev" },
  });
});

it("does not load the checkout's configured port when a manual worktree has several services", async () => {
  const { resolver, links } = setup(
    { agentWorktrees: [{ path: "/repo/manual", branch: "manual", at: 1 }] },
    { "/repo": [3000], "/repo/manual": [5173, 8080] },
  );
  const target = await resolver.target("project", "one", undefined, links);
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
  const { resolver, links } = setup(
    {
      agentWorktrees: [
        { path: "/repo/a", branch: "a", at: 1 },
        { path: "/repo/b", branch: "b", at: 1 },
      ],
    },
    { "/repo/a": [5173], "/repo/b": [8080] },
  );
  const target = await resolver.target(
    "project",
    "one",
    "https://example.com/",
    links,
  );
  expect(target.folder).toBe("/repo");
  expect(target.dev).toBeUndefined();
});

it("rejects an overflowing configured port during target resolution", async () => {
  const { resolver, links } = setup(
    {
      worktree: {
        path: "/repo/managed",
        branch: "managed",
      } as ProjectChat["worktree"],
    },
    {},
    65530,
  );
  await expect(
    resolver.target("project", "one", undefined, links),
  ).rejects.toThrow("dev port 65530 plus worktree offset 10");
});
