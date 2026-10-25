import { describe, expect, it } from "vitest";
import { capWritten, commandActions, shownCommand, writtenByCommand, writtenLimit } from "./call-actions";

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

it("cuts written code past the limit and says so", () => {
  const big = "x".repeat(writtenLimit + 10);
  const [first, second] = capWritten([
    { kind: "whole", path: "a", content: big },
    { kind: "whole", path: "b", content: "y" },
  ]);
  expect(first).toMatchObject({ path: "a", cut: true });
  expect(first?.kind === "whole" && first.content.length).toBe(writtenLimit);
  expect(second).toBeUndefined();
});

it("finds the hash in git commit's own line too", () => {
  expect(commandActions(`git commit -m "x"`, "[relay/a 1a2b3c4d] x\n 1 file changed")).toEqual([
    { kind: "commit", subject: "x", hash: "1a2b3c4d" },
  ]);
});
