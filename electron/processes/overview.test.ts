import { describe, expect, it } from "vitest";
import type { ProcessRow } from "../platform/processes";
import { agentName } from "../terminal/tasks";
import { buildOverview, type OverviewInput } from "./overview";

const row = (
  pid: number,
  ppid: number,
  line: string,
  cpu: number,
  mb: number,
): ProcessRow => ({ pid, ppid, pgid: pid, started: 1000 + pid, line, cpu, mb });

// Relay (100) with a renderer and a GPU process; an agent host (200) runs
// Claude (300) in a thread's worktree, with an MCP server under it and a dev
// server it started; a detached watcher sits in the checkout.
const rows = [
  row(100, 1, "/Applications/Relay.app/Contents/MacOS/Relay", 5, 300),
  row(101, 100, "/Applications/Relay.app/Contents/Frameworks/Relay Helper (Renderer).app/x --type=renderer", 20, 400),
  row(102, 100, "/Applications/Relay.app/Contents/Frameworks/Relay Helper (Renderer).app/x --type=renderer", 1, 100),
  row(103, 100, "/Applications/Relay.app/Contents/Frameworks/Relay Helper (GPU).app/x --type=gpu-process", 4, 150),
  row(104, 100, "/bin/zsh -l", 0, 5),
  row(200, 1, "/usr/local/bin/node agent-host.mjs --relay-agent-host", 1, 60),
  row(300, 200, "/Users/me/.local/bin/claude --output-format stream-json", 30, 500),
  row(301, 300, "/usr/local/bin/node /Users/me/mcp/server.js", 2, 80),
  row(310, 300, "/bin/zsh -c npm run dev", 0, 4),
  row(311, 310, "/usr/local/bin/node /w/node_modules/.bin/vite", 60, 250),
  row(400, 1, "/usr/local/bin/node /p/node_modules/.bin/tsc --watch", 3, 120),
  row(900, 1, "/Applications/Other.app/Contents/MacOS/Other", 99, 9999),
];

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  rows,
  relayPids: [100, 200],
  terminals: new Set([104]),
  projects: [
    {
      id: "p1",
      name: "Shop",
      root: "/p",
      worktrees: [{ path: "/w", chatId: "c1" }],
      tasks: [
        {
          id: "310:1310",
          command: "npm run dev",
          kind: "server",
          title: "Vite dev server",
          agent: "claude",
          origin: "relay",
          chatId: "c1",
          folder: "/w",
          started: 1310,
          ports: [5173],
          pids: 2,
          members: [310, 311],
        },
        {
          id: "400:1400",
          command: "tsc --watch",
          kind: "watch",
          title: "Watching tsc",
          origin: "detached",
          folder: "/p",
          started: 1400,
          ports: [],
          pids: 1,
          members: [400],
        },
      ],
    },
  ],
  agentOf: agentName,
  agentFolders: new Map([[300, "/w"]]),
  agentWork: () => undefined,
  cpuOf: (r) => r.cpu,
  threads: new Map([
    ["c1", { title: "Checkout flow", settled: false, projectId: "p1" }],
    ["c2", { title: "Fix the cart", settled: false, projectId: "p1" }],
  ]),
  machine: { cores: 8, totalMb: 16384 },
  platform: "darwin",
  now: 5000,
  ...over,
});

describe("buildOverview", () => {
  it("counts each process once: in its task, its agent, or Relay's own share", () => {
    const o = buildOverview(input());
    const [project] = o.projects;
    const [checkout, worktree] = project.folders;
    expect(checkout.path).toBe("/p");
    expect(worktree.thread).toEqual({ id: "c1", title: "Checkout flow" });
    const byTitle = Object.fromEntries(
      [...worktree.entries, ...checkout.entries, ...o.relay.entries].map(
        (e) => [e.title, e],
      ),
    );
    // The dev server is the task's, not Claude's; the MCP server is Claude's.
    expect(byTitle["Vite dev server"]).toMatchObject({ cpu: 60, mb: 254, processes: 2 });
    expect(byTitle.claude).toMatchObject({ cpu: 32, mb: 580, processes: 2, thread: { id: "c1" } });
    expect(byTitle["Windows and pages"]).toMatchObject({ cpu: 21, processes: 2 });
    expect(byTitle["Terminal shells"]).toMatchObject({ processes: 1 });
    expect(byTitle["Agent hosts"]).toMatchObject({ processes: 1 });
    // Another app never shows; the total is exactly what's listed.
    expect(o.total).toEqual({ cpu: 5 + 21 + 4 + 0 + 1 + 32 + 60 + 3, mb: 300 + 500 + 150 + 5 + 60 + 580 + 254 + 120 });
  });

  it("marks what was left running", () => {
    const settled = buildOverview(
      input({
        threads: new Map([
          ["c1", { title: "Checkout flow", settled: true, projectId: "p1" }],
        ]),
      }),
    );
    const entries = settled.projects[0].folders.flatMap((f) => f.entries);
    expect(entries.find((e) => e.title === "Watching tsc")?.leftBehind).toBe("starter-gone");
    expect(entries.find((e) => e.title === "Vite dev server")?.leftBehind).toBe("settled");
    expect(entries.find((e) => e.kind === "agent")?.leftBehind).toBeUndefined();
  });

  it("places an agent by the commands it ran where the OS can't tell its folder", () => {
    const o = buildOverview(
      input({
        agentFolders: new Map(),
        agentWork: (pid) => (pid === 300 ? { chatId: "c1", root: "/w" } : undefined),
      }),
    );
    const agent = o.projects[0].folders
      .find((f) => f.path === "/w")
      ?.entries.find((e) => e.kind === "agent");
    expect(agent?.thread?.id).toBe("c1");
    const lost = buildOverview(input({ agentFolders: new Map() }));
    expect(lost.relay.entries.some((e) => e.kind === "agent")).toBe(true);
  });

  it("names a hosted Claude's thread from Relay's token on its command line", () => {
    const line = `/Users/me/.local/bin/claude --mcp-config {"mcpServers":{"relay":{"headers":{"Authorization":"Bearer c2.sig-nature_1"}}}}`;
    const o = buildOverview(
      input({
        rows: rows.map((r) => (r.pid === 300 ? { ...r, line } : r)),
        agentFolders: new Map(),
      }),
    );
    // Without a folder from the OS it goes where its thread works: the checkout.
    const agent = o.projects[0].folders
      .find((f) => f.path === "/p")
      ?.entries.find((e) => e.kind === "agent");
    expect(agent?.thread).toEqual({ id: "c2", title: "Fix the cart" });
  });

  it("leaves CPU unknown until there's a reading, keeping memory", () => {
    const o = buildOverview(input({ cpuOf: () => undefined }));
    expect(o.total.cpu).toBeUndefined();
    expect(o.total.mb).toBeGreaterThan(0);
  });
});
