import { describe, expect, it } from "vitest";
import {
  commandKey,
  describeTask,
  shellCommand,
  taskNote,
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

it("writes a private note that tells the agent who started what", () => {
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
  const note = taskNote(
    [
      task({ chatId: "a" }),
      task({ id: "2", chatId: "b", command: "vitest", ports: [] }),
      task({ id: "3", origin: "external", agent: "codex" }),
    ],
    "a",
    12 * 60000,
  )!;
  expect(note).toContain(
    '"npm run dev" (Dev server, listening on :5173; running 12m; started earlier in this conversation)',
  );
  expect(note).toContain("started by another Relay conversation");
  expect(note).toContain("started by a codex CLI session outside Relay");
  expect(note).toContain("don't mention it unless");
});
