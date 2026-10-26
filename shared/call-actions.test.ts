import { describe, expect, it } from "vitest";
import { callActions, commandActions, shownCommand, writtenByCommand } from "./call-actions";
import { capWritten, writtenLimit } from "./written-code";

describe("commandActions", () => {
  it("reads sed, cat and grep as the reads and searches they are", () => {
    expect(commandActions("cd app && sed -n 160,180p src/a.tsx | head -5")).toEqual([
      { kind: "read", file: "src/a.tsx", lines: "160–180" },
    ]);
    expect(commandActions(`grep -rn -A8 "foo" src --include='*.css' | head -20`)).toEqual([
      { kind: "search", pattern: "foo", where: "src" },
    ]);
  });

  it("takes a python script that rewrites a file for an edit of it", () => {
    const command = `python3 - <<'EOF'\np="src/a.ts"\ns=open(p).read()\ns=s.replace("a","b")\nEOF\ngrep -n x src/a.ts`;
    expect(commandActions(command)).toEqual([
      { kind: "edit", file: "src/a.ts" },
      { kind: "search", pattern: "x", where: "src/a.ts" },
    ]);
  });

  it("tells a test run's result and a commit's hash from the output", () => {
    expect(commandActions("npx vitest run a.test.ts", " FAIL  a.test.ts > b")).toEqual([
      { kind: "test", target: "a.test.ts", failed: true },
    ]);
    expect(
      commandActions(`npm run typecheck >/tmp/tc.txt 2>&1; git add a.ts && git commit -qm "Let rg's flags through"`, "tc 0\n32ef54ed Let"),
    ).toEqual([
      { kind: "check", name: "typecheck", failed: false },
      { kind: "commit", subject: "Let rg's flags through", hash: "32ef54ed" },
    ]);
  });

  it("keeps a commit's subject when the label was cut inside the message", () => {
    expect(commandActions(`git commit -qm "Let a reviewer's rg take \`rg -g '*.{ts}'`)).toEqual([
      { kind: "commit", subject: "Let a reviewer's rg take `rg -g '*.{ts}'" },
    ]);
  });

  it("names a loop it can't see into, and a command that only set up", () => {
    expect(commandActions("cd /tmp && mkdir -p x; for f in a b")).toEqual([{ kind: "run", what: "shell loop" }]);
    expect(commandActions("echo three")).toEqual([{ kind: "run", what: "echo" }]);
  });
});

it("shows a command without its cd, filters and heredoc body", () => {
  expect(shownCommand("cd /tmp && sed -n 1,2p a.ts 2>&1 | head -3")).toBe("sed -n 1,2p a.ts");
  expect(shownCommand("python3 - <<'EOF'\nprint(1)\nEOF")).toBe("python3 - <<'EOF'");
});

it("keeps what a heredoc writes to a file", () => {
  expect(writtenByCommand("rg --version; cat > /tmp/a.mts <<'EOF'\nimport x from \"y\";\nEOF\nnpx tsx /tmp/a.mts")).toEqual([
    { kind: "whole", path: "/tmp/a.mts", content: 'import x from "y";' },
  ]);
  expect(writtenByCommand("python3 - <<'EOF'\nprint(1)\nEOF")).toEqual([]);
});

it("cuts written code past the limit and still names every file", () => {
  const big = "x".repeat(writtenLimit + 10);
  const [first, second] = capWritten([
    { kind: "whole", path: "a", content: big },
    { kind: "whole", path: "b", content: "y" },
  ]);
  expect(first).toMatchObject({ path: "a", cut: true });
  expect(first?.kind === "whole" && first.content.length).toBe(writtenLimit);
  expect(second).toEqual({ kind: "whole", path: "b", content: "", cut: true });
});

it("finds the hash in git commit's own line too", () => {
  expect(commandActions(`git commit -m "x"`, "[relay/a 1a2b3c4d] x\n 1 file changed")).toEqual([
    { kind: "commit", subject: "x", hash: "1a2b3c4d" },
  ]);
});

describe("what Codex ran", () => {
  it("reads the command inside the shell Codex wraps it in, cut short or not", () => {
    expect(commandActions(`/bin/zsh -lc 'sed -n 1,20p src/a.ts'`)).toEqual([
      { kind: "read", file: "src/a.ts", lines: "1–20" },
    ]);
    expect(commandActions(`/bin/zsh -lc "rg -n 'foo' src`)).toEqual([{ kind: "search", pattern: "foo", where: "src" }]);
    expect(shownCommand(`/bin/zsh -lc 'cd app && git status'`)).toBe("git status");
    expect(writtenByCommand(`bash -lc 'cat > /tmp/a.txt <<'\\''EOF'\\''\nhi\nEOF'`)).toEqual([
      { kind: "whole", path: "/tmp/a.txt", content: "hi" },
    ]);
  });

  it("names each file a patch changed, made or edited", () => {
    const call = {
      id: "p",
      kind: "file" as const,
      status: "complete" as const,
      label: "a.ts +1 more",
      written: [
        { kind: "whole" as const, path: "a.ts", content: "x" },
        { kind: "patch" as const, path: "b.ts", diff: "@@ -1 +1 @@\n-a\n+b" },
      ],
    };
    expect(callActions(call)).toEqual([
      { kind: "create", file: "a.ts" },
      { kind: "edit", file: "b.ts" },
    ]);
    expect(callActions({ id: "q", kind: "file", status: "complete", label: "a.ts +1 more", detail: "boom" })).toEqual([
      { kind: "edit", file: "a.ts +1 more" },
    ]);
  });
});

describe("whether a test or check failed", () => {
  it("fails a test or check whose call failed when the output didn't say", () => {
    const call = { id: "t", kind: "command" as const, status: "failed" as const, label: "npm run lint", detail: "exit 1" };
    expect(callActions(call)).toEqual([{ kind: "check", name: "lint", failed: true }]);
  });

  it("tells each test run in one command by the failures naming its file", () => {
    const output = " FAIL  b.test.ts > x\n ✓ a.test.ts";
    expect(commandActions("npx vitest run a.test.ts && npx vitest run b.test.ts", output)).toEqual([
      { kind: "test", target: "a.test.ts", failed: false },
      { kind: "test", target: "b.test.ts", failed: true },
    ]);
    expect(commandActions("npx vitest run", "Tests  12 passed, 0 failed")).toEqual([{ kind: "test", failed: false }]);
  });

  it("reads lint and npm failures", () => {
    expect(commandActions("npm run lint", "✖ 3 problems (3 errors)")).toEqual([{ kind: "check", name: "lint", failed: true }]);
    expect(commandActions("npm run format:check", "Code style issues found")).toEqual([
      { kind: "check", name: "format:check", failed: true },
    ]);
  });
});

describe("commands that look like something else", () => {
  it("takes a commit's subject from the heredoc it reads the message from", () => {
    const command = `git commit -m "$(cat <<'EOF'\nfix(x): keep the subject\n\nBody.\nEOF\n)"`;
    expect(commandActions(command)).toEqual([{ kind: "commit", subject: "fix(x): keep the subject" }]);
    expect(commandActions("git commit -F - <<'EOF'\nfeat: from stdin\nEOF")).toEqual([
      { kind: "commit", subject: "feat: from stdin" },
    ]);
  });

  it("reads rg -e patterns, quoted output files and git's own options", () => {
    expect(commandActions(`rg -n -e "foo" src`)).toEqual([{ kind: "search", pattern: "foo", where: "src" }]);
    expect(writtenByCommand(`cat > "/tmp/my file.ts" <<'EOF'\nx\nEOF`)).toEqual([
      { kind: "whole", path: "/tmp/my file.ts", content: "x" },
    ]);
    expect(commandActions("git -C app status")).toEqual([{ kind: "git", what: "git status" }]);
  });

  it("doesn't take a quoted << for a heredoc, nor a heredoc piped on for a read", () => {
    expect(commandActions(`grep -n "<<EOF" a.sh`)).toEqual([{ kind: "search", pattern: "<<EOF", where: "a.sh" }]);
    expect(commandActions("cat <<'EOF' | node\nconsole.log(1)\nEOF")).toEqual([{ kind: "run", what: "node script" }]);
  });

  it("tells package scripts that test or check from ones that only run", () => {
    expect(commandActions("npm install")).toEqual([{ kind: "run", what: "npm install" }]);
    expect(commandActions("pnpm run dev")).toEqual([{ kind: "run", what: "pnpm dev" }]);
    expect(commandActions("npm run test:unit")).toEqual([{ kind: "test", failed: false }]);
  });

  it("names a script run from a file by it, and a script that only reads by its program", () => {
    expect(commandActions("python3 /tmp/check.py")).toEqual([{ kind: "run", what: "check.py" }]);
    expect(commandActions(`python3 - <<'EOF'\np="a.ts"\nprint(open(p).read())\nEOF`)).toEqual([
      { kind: "run", what: "python3 script" },
    ]);
  });
});

describe("git and shell words around a search", () => {
  it("reads git grep as a search of the paths after --", () => {
    const command = `b=$(git merge-base HEAD main); git grep -n "FileEntryIcon" $b -- src/features/agent-turn | head; echo ---; git grep -n "Icon" HEAD -- src/features/agent-turn | head`;
    expect(commandActions(command)).toEqual([
      { kind: "search", pattern: "FileEntryIcon", where: "src/features/agent-turn" },
      { kind: "search", pattern: "Icon", where: "src/features/agent-turn" },
    ]);
  });

  it("takes a path but not a revision as where git grep looked, without --", () => {
    expect(commandActions(`git grep -e "a b" -n main src/app.ts`)).toEqual([
      { kind: "search", pattern: "a b", where: "src/app.ts" },
    ]);
  });

  it("reads the command after a value worked out with $()", () => {
    expect(commandActions("out=$(git rev-parse HEAD) npm test")).toEqual([{ kind: "test", failed: false }]);
  });
});

describe("words before the program", () => {
  it("reads past a subshell's ( and timeout's duration", () => {
    expect(commandActions("(cd app && npm test)")).toEqual([{ kind: "test", failed: false }]);
    expect(commandActions("timeout -s KILL 60 npx vitest run a.test.ts")).toEqual([
      { kind: "test", target: "a.test.ts", failed: false },
    ]);
  });
});

