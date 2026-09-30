import { describe, expect, it } from "vitest";
import { liveCwd } from "../../electron/tasks";
import {
  commandKey,
  describeTask,
  shellCommand,
  taskNote,
  lastingTask,
  tidyCommand,
  type ProjectTask,
} from "../../shared/tasks";

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
