import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import type { ProcessRow } from "../platform/processes";
import { agentName, liveCwd, netstatListening, projectTasks } from "./tasks";
import {
  commandKey,
  describeTask,
  shellCommand,
  taskNote,
  lastingTask,
  tidyCommand,
  windowsArgs,
  type ProjectTask,
} from "../../shared/tasks";

// A stand-in process table: what `ps` would list, where each process works,
// and the shell `restart` spawns.
const fake = vi.hoisted(() => ({
  rows: [] as ProcessRow[],
  cwd: "",
  spawned: 0,
  /** Whether each read of the table asked for costs. */
  usage: [] as boolean[],
  /** What each pid listens on, and the pids each look for listeners asked about. */
  listening: new Map<number, number>(),
  listenLooks: [] as string[],
}));

vi.mock("../platform/processes", () => ({
  processTable: async ({ usage = false } = {}) => {
    fake.usage.push(usage);
    return fake.rows.map((r) => ({ ...r }));
  },
  CpuRates: class {
    fill() {}
  },
}));

vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  cpus: () => Array.from({ length: 12 }, () => ({})),
}));

vi.mock("node:fs/promises", () => ({
  readlink: async () => fake.cwd,
}));

vi.mock("node:child_process", () => ({
  // `lsof`: every process asked about works in the project.
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    done: (e: null, out: string) => void,
  ) => {
    const pids = args[args.length - 1]!.split(",");
    if (args.includes("-sTCP:LISTEN")) {
      fake.listenLooks.push(args[args.length - 1]!);
      const found = pids.filter((pid) => fake.listening.has(+pid));
      return done(
        null,
        found.map((pid) => `p${pid}\nn*:${fake.listening.get(+pid)}`).join("\n"),
      );
    }
    if (!args.includes("cwd")) return done(null, "");
    done(null, pids.map((pid) => `p${pid}\nn${fake.cwd}`).join("\n"));
  },
  spawn: vi.fn(() => ({ pid: fake.spawned, on: () => {}, unref: () => {} })),
}));

describe("shellCommand", () => {
  it("reads the command Claude Code evals", () => {
    const line = `/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB 2>/dev/null || true && eval 'npm run dev -- --port 5173 && echo '"'"'ok'"'"'' < /dev/null && pwd -P >| /tmp/claude-dd41-cwd`;
    expect(shellCommand(line)).toBe("npm run dev -- --port 5173 && echo 'ok'");
  });

  it("reads Codex's login shell, sandboxed or not", () => {
    expect(shellCommand("/bin/zsh -lc npm run dev")).toBe("npm run dev");
    expect(
      shellCommand(
        "/usr/bin/sandbox-exec -p (version 1) (deny default) -DWRITABLE_ROOT_0=/p -- /bin/zsh -lc pnpm test --watch",
      ),
    ).toBe("pnpm test --watch");
  });

  it("ignores processes that aren't shell commands", () => {
    expect(shellCommand("/opt/homebrew/bin/rg --files")).toBeUndefined();
    expect(shellCommand("/bin/zsh -l")).toBeUndefined();
  });
});

describe("Windows command lines", () => {
  it("splits them as Windows programs do", () => {
    expect(
      windowsArgs(String.raw`"C:\Program Files\Git\bin\bash.exe" -c "echo \"hi\" a\\b"`),
    ).toEqual([String.raw`C:\Program Files\Git\bin\bash.exe`, "-c", String.raw`echo "hi" a\\b`]);
    expect(windowsArgs(String.raw`a "b c"d  e\\"f g"`)).toEqual(["a", "b cd", String.raw`e\f g`]);
  });

  it("reads what Git Bash, PowerShell and cmd run", () => {
    expect(
      shellCommand(
        String.raw`"C:\Program Files\Git\bin\bash.exe" -c -l "source C:/Users/me/.claude/shell-snapshots/s.sh && eval 'npm run dev' < /dev/null"`,
      ),
    ).toBe("npm run dev");
    expect(
      shellCommand(
        String.raw`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "pnpm test --watch"`,
      ),
    ).toBe("pnpm test --watch");
    expect(shellCommand(String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c "npm start"`)).toBe(
      "npm start",
    );
    expect(shellCommand(String.raw`"C:\Program Files\nodejs\node.exe" server.js`)).toBeUndefined();
  });

  it("shortens their executables", () => {
    expect(
      tidyCommand(
        String.raw`"C:\Program Files\nodejs\node.exe" C:\app\node_modules\vite\bin\vite.js --port 5173`,
      ),
    ).toBe("node vite --port 5173");
  });

  it("finds listening ports in netstat's table, whatever the state is called", () => {
    const out = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:5173           0.0.0.0:0              NASLOUCHÁNÍ     4120",
      "  TCP    127.0.0.1:5173         127.0.0.1:51234        ESTABLISHED     4120",
      "  TCP    [::]:3000              [::]:0                 LISTENING       880",
      "  UDP    0.0.0.0:5353           *:*                                    880",
    ].join("\r\n");
    expect(netstatListening(out)).toEqual([
      [4120, 5173],
      [880, 3000],
    ]);
  });
});

describe("tidyCommand", () => {
  it("shortens executables and package binaries", () => {
    expect(
      tidyCommand(
        "/usr/local/bin/node /app/node_modules/.bin/vite --host 127.0.0.1",
      ),
    ).toBe("node vite --host 127.0.0.1");
    expect(
      tidyCommand(
        "/Users/me/Library/Application Support/Tool/bin/tool-worker --flag /Users/me/x",
      ),
    ).toBe("tool-worker --flag /Users/me/x");
    expect(
      tidyCommand(
        "/opt/homebrew/Frameworks/Python.app/Contents/MacOS/Python -m http.server 8765",
      ),
    ).toBe("python -m http.server 8765");
  });
});

describe("describeTask", () => {
  it.each([
    ["npm run dev", [], "server", "Dev server"],
    [
      "cd web && vite --port 5173 > /tmp/log 2>&1 &",
      [5173],
      "server",
      "Vite dev server",
    ],
    ["npx vitest", [], "watch", "Vitest watching tests"],
    ["npx vitest run 2>&1 | tail -15", [], "test", "Vitest tests"],
    ["pnpm test", [], "test", "Tests"],
    ["tsc -w -p .", [], "watch", "Watcher"],
    ["npm run build", [], "build", "Building project"],
    ["npm ci", [], "install", "Installing dependencies"],
    ["docker compose up", [], "container", "Docker Compose"],
    ["git fetch --all", [], "git", "Git fetch"],
    ["python3 -m http.server 8000", [8000], "server", "Python HTTP server"],
    ["sleep 120", [], "script", "sleep"],
  ])("%s", (command, ports, kind, title) => {
    expect(describeTask(command, ports as number[])).toEqual({ kind, title });
  });
});

it("matches an agent's command to the process running it", () => {
  expect(commandKey("/bin/zsh -lc 'npm run dev'")).toBe(
    commandKey("npm run dev"),
  );
  expect(commandKey("cd app && npm run dev 2>&1 &")).toBe("npm run dev");
});

it("tells a session what's running once, then only what changed", () => {
  const task = (patch: Partial<ProjectTask>): ProjectTask => ({
    id: "1",
    command: "npm run dev",
    kind: "server",
    title: "Dev server",
    origin: "relay",
    started: 0,
    ports: [5173],
    pids: 2,
    ...patch,
  });
  expect(taskNote([], "a")).toBeUndefined();
  const dev = task({ chatId: "a" });
  const external = task({ id: "3", origin: "external", ports: [9333] });
  const note = taskNote([dev, external], "a")!;
  expect(note).toContain(
    '- Dev server on :5173 (started in this conversation): "npm run dev"',
  );
  expect(note).toContain('- Dev server on :9333: "npm run dev"');
  expect(note).not.toMatch(/running \d|CLI session/);
  // Nothing changed: nothing to say.
  expect(taskNote([dev, external], "a", [dev, external])).toBeUndefined();
  const watcher = task({ id: "4", kind: "watch", title: "Watcher", ports: [] });
  const update = taskNote([dev, watcher], "a", [dev, external])!;
  expect(update).toContain('Now running:\n- Watcher: "npm run dev"');
  expect(update).toContain('Stopped:\n- Dev server on :9333: "npm run dev"');
  expect(update).not.toContain(":5173");
});

it("tells an agent in a worktree that the checkout's servers don't serve its files", () => {
  const checkout: ProjectTask = {
    id: "1",
    command: "npm run dev",
    kind: "server",
    title: "Dev server",
    origin: "detached",
    started: 0,
    ports: [5173],
    pids: 2,
  };
  const note = taskNote([], "a", undefined, {
    path: "/data/worktrees/relay/split",
    checkout: "/code/relay",
    running: [checkout],
  })!;
  expect(note).toContain('own Git worktree at "/data/worktrees/relay/split"');
  expect(note).toContain(
    "Running in the project's checkout, not here: these serve the checkout's files, not your changes.",
  );
  expect(note).toContain('- Dev server on :5173: "npm run dev"');
  expect(note).not.toContain("Already running in this worktree");
});

it("leaves one-off commands out of the note", () => {
  const base = {
    command: "npx vitest run",
    title: "Vitest",
    origin: "relay" as const,
    started: 0,
    pids: 1,
  };
  expect(lastingTask({ ...base, id: "1", kind: "test", ports: [] })).toBe(
    false,
  );
  expect(lastingTask({ ...base, id: "2", kind: "script", ports: [9333] })).toBe(
    true,
  );
  expect(lastingTask({ ...base, id: "3", kind: "watch", ports: [] })).toBe(
    true,
  );
});

describe("liveCwd", () => {
  it("drops the suffix Linux adds to a deleted working folder", () => {
    expect(liveCwd("/home/jan/work/search (deleted)")).toBe(
      "/home/jan/work/search",
    );
    expect(liveCwd("/home/jan/work/search")).toBe("/home/jan/work/search");
  });
});

it("keeps a restarted task with the thread and agent that started it", async () => {
  const root = "/projects/restart-owner";
  fake.cwd = root;
  const started = Date.now() - 60000;
  const host = 2_000_001;
  const agent = 2_000_002;
  const shell = 2_000_003;
  fake.spawned = 2_000_004;
  fake.rows = [
    { pid: process.pid, ppid: 2_000_000, pgid: 0, started: 1, line: "relay" },
    { pid: host, ppid: process.pid, pgid: 0, started, line: "agent-host" },
    { pid: agent, ppid: host, pgid: 0, started, line: "/usr/local/bin/claude" },
    { pid: shell, ppid: agent, pgid: 0, started, line: "/bin/zsh -lc npm run dev" },
  ];
  projectTasks.hosts = () => [host];
  projectTasks.record(root, "thread-1", "npm run dev");
  // Stopping the old shell takes it out of the table.
  const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
    fake.rows = fake.rows.filter((r) => r.pid !== pid);
    return true;
  });
  try {
    const [before] = await projectTasks.list(root, [], { fresh: true });
    expect(before).toMatchObject({ origin: "relay", chatId: "thread-1", agent: "claude" });

    await projectTasks.restart(root, before.id);
    expect(kill).toHaveBeenCalledWith(shell, "SIGTERM");
    // Relay's own spawn of the command, a child of Relay.
    fake.rows.push({
      pid: fake.spawned,
      ppid: process.pid,
      pgid: fake.spawned,
      started: Date.now(),
      line: "/bin/zsh -lc npm run dev",
    });
    const after = await projectTasks.list(root, [], { fresh: true });
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(before.id);
    // Not "detached": the Processes page would sweep it as starter-gone.
    expect(after[0]).toMatchObject({
      origin: "relay",
      chatId: "thread-1",
      agent: "claude",
      command: "npm run dev",
    });
  } finally {
    kill.mockRestore();
  }
});

it("looks for listening ports once for lists asked for together", async () => {
  const root = "/projects/sites";
  fake.cwd = root;
  const started = Date.now() - 60000;
  const [host, agent, web, api] = [3_000_001, 3_000_002, 3_000_003, 3_000_004];
  fake.rows = [
    { pid: process.pid, ppid: 3_000_000, pgid: 0, started: 1, line: "relay" },
    { pid: host, ppid: process.pid, pgid: 0, started, line: "agent-host" },
    { pid: agent, ppid: host, pgid: 0, started, line: "/usr/local/bin/claude" },
    { pid: web, ppid: agent, pgid: 0, started, line: "/bin/zsh -lc npm run dev" },
    { pid: api, ppid: agent, pgid: 0, started, line: "/bin/zsh -lc npm run api" },
  ];
  fake.listening = new Map([[web, 5173], [api, 3000]]);
  projectTasks.hosts = () => [host];
  await projectTasks.list(root, [], { fresh: true });
  fake.listenLooks = [];
  const lists = await Promise.all([
    projectTasks.list(root, [], { fresh: true }),
    projectTasks.list(root),
  ]);
  expect(fake.listenLooks).toHaveLength(1);
  for (const tasks of lists)
    expect(tasks.map((t) => t.ports)).toEqual([[5173], [3000]]);
});

it("counts a task's CPU as a share of the whole computer, not of one core", async () => {
  const root = "/projects/costly";
  fake.cwd = root;
  const started = Date.now() - 60000;
  const host = 2_100_001;
  const agent = 2_100_002;
  const shell = 2_100_003;
  fake.rows = [
    { pid: process.pid, ppid: 2_100_000, pgid: 0, started: 1, line: "relay" },
    { pid: host, ppid: process.pid, pgid: 0, started, line: "agent-host" },
    { pid: agent, ppid: host, pgid: 0, started, line: "/usr/local/bin/claude" },
    { pid: shell, ppid: agent, pgid: 0, started, line: "/bin/zsh -lc npm run dev", cpu: 0.5, mb: 3 },
    // Six of the twelve cores busy, as `ps` counts it.
    { pid: 2_100_004, ppid: shell, pgid: 0, started, line: "node vite", cpu: 599.5, mb: 400 },
  ];
  projectTasks.hosts = () => [host];
  projectTasks.record(root, "thread-2", "npm run dev");
  const [plain] = await projectTasks.list(root, [], { fresh: true });
  expect(plain.cpu).toBeUndefined();
  const [costed] = await projectTasks.list(root, [], { fresh: true, costed: true });
  expect(costed).toMatchObject({ cpu: 50, mb: 403 });
});

it("reads costs again when a plain scan was under way or came since", async () => {
  fake.rows = [];
  fake.usage = [];
  // The Running card's plain look is on its way as the Processes page asks.
  const plain = projectTasks.list("/costs", [], { fresh: true });
  await projectTasks.costedTable();
  await plain;
  expect(fake.usage).toEqual([false, true]);
  // Read with costs just now: asked again, it uses that.
  await projectTasks.costedTable();
  expect(fake.usage).toEqual([false, true]);
  // A plain look since replaced them.
  await projectTasks.list("/costs", [], { fresh: true });
  await projectTasks.costedTable();
  expect(fake.usage).toEqual([false, true, false, true]);
});

it.skipIf(process.platform === "win32")(
  "doesn't take the Claude and Codex desktop apps for the CLIs",
  () => {
    expect(
      agentName("/Applications/Claude.app/Contents/MacOS/Claude"),
    ).toBeUndefined();
    expect(
      agentName("/Applications/Codex.app/Contents/MacOS/Codex --type=gpu"),
    ).toBeUndefined();
    expect(agentName("/opt/homebrew/bin/claude --resume x")).toBe("claude");
  },
);

it("delegates managed restarts only after validating the project and live process identity", async () => {
  const root = "/projects/managed-restart";
  fake.cwd = root;
  const pid = 9_000_001;
  const started = Date.now() - 60000;
  fake.rows = [
    { pid, ppid: process.pid, pgid: pid, started, line: "node server.js" },
  ];
  const restart = vi.fn(async (stop: () => Promise<void>) => {
    await stop();
  });
  projectTasks.trackServer(pid, "node server.js", root, restart);
  const [task] = await projectTasks.list(root, [], { fresh: true });
  const kill = vi.spyOn(process, "kill").mockImplementation((target) => {
    fake.rows = fake.rows.filter((p) => p.pid !== Math.abs(target));
    return true;
  });
  vi.mocked(spawn).mockClear();
  try {
    await expect(
      projectTasks.restart("/another-project", task!.id),
    ).rejects.toThrow("no longer running");
    expect(restart).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    await projectTasks.restart(root, task!.id);
    expect(restart).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith(-pid, "SIGTERM");
    expect(spawn).not.toHaveBeenCalled();

    fake.rows = [
      {
        pid,
        ppid: process.pid,
        pgid: pid,
        started: started + 1,
        line: "another process",
      },
    ];
    await expect(projectTasks.restart(root, task!.id)).rejects.toThrow(
      "no longer running",
    );
    expect(restart).toHaveBeenCalledOnce();
  } finally {
    kill.mockRestore();
  }
});

it.each(["leader", "child"])(
  "does not force-kill a reused %s PID or its new process group",
  async (reused) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const root = `/projects/reused-${reused}`;
    fake.cwd = root;
    const [leader, child] =
      reused === "leader" ? [9_100_001, 9_100_002] : [9_200_001, 9_200_002];
    const started = Date.now() - 60_000;
    const replaced = reused === "leader" ? leader : child;
    fake.rows = [
      {
        pid: leader,
        ppid: process.pid,
        pgid: leader,
        started,
        line: "node server.js",
      },
      {
        pid: child,
        ppid: leader,
        pgid: child,
        started,
        line: "node worker.js",
      },
    ];
    projectTasks.trackServer(leader, "node server.js", root, async (stop) =>
      stop(),
    );
    const [task] = await projectTasks.list(root, [], { fresh: true });
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === "SIGKILL")
        fake.rows = fake.rows.filter((row) => row.pid !== Math.abs(pid));
      return true;
    });
    try {
      const restarting = projectTasks.restart(root, task!.id);
      await vi.waitFor(() =>
        expect(kill).toHaveBeenCalledWith(leader, "SIGTERM"),
      );
      // One original process survives the grace period, but the other exits
      // and its PID now belongs to an unrelated process and process group.
      fake.rows = fake.rows.map((row) =>
        row.pid === replaced
          ? { ...row, ppid: 1, started: started + 1, line: "unrelated process" }
          : { ...row, ppid: 1 },
      );
      await vi.advanceTimersByTimeAsync(4000);
      await restarting;
      expect(kill).not.toHaveBeenCalledWith(replaced, "SIGKILL");
      expect(kill).not.toHaveBeenCalledWith(-replaced, "SIGKILL");
      expect(kill).toHaveBeenCalledWith(
        reused === "leader" ? child : leader,
        "SIGKILL",
      );
      expect(fake.rows).toMatchObject([
        { pid: replaced, started: started + 1 },
      ]);
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  },
);
