import { expect, it } from "vitest";
import type { AgentActivity } from "./projects";
import { actionVerb, rowsOf, runSummary, traceTree, type TracePiece } from "./trace-tree";

let n = 0;

const call = (kind: AgentActivity["kind"], label: string, extra: Partial<AgentActivity> = {}): AgentActivity => ({
  id: `c${++n}`,
  kind,
  label,
  status: "complete",
  ...extra,
});

/** Each piece as one line, so a case reads like the trace. */
const outline = (pieces: TracePiece[]) =>
  pieces.map((p) => {
    const what = (r: { action: { kind: string } }) => r.action.kind;
    if (p.kind === "row") return what(p.row);
    if (p.kind === "pair") return `${what(p.rows[0])} + ${what(p.rows[1])}`;
    return `${p.heading}: ${p.rows.map(what).join(", ")}`;
  });

it("groups by what the calls did, not the order they came in", () => {
  const pieces = traceTree([
    call("command", "grep -n a src/a.ts"),
    call("read", "src/a.ts"),
    call("command", "grep -n b src/b.ts"),
    call("command", "grep -n c src/c.ts"),
    call("read", "src/b.ts"),
  ]);
  expect(outline(pieces)).toEqual(["Searched 3 times: search, search, search", "read + read"]);
});

it("splits commands at each script written for them", () => {
  const pieces = traceTree([
    call("file", "/tmp/a.mjs", { detail: "File created successfully at: /tmp/a.mjs" }),
    call("command", "node /tmp/a.mjs"),
    call("command", "rg --version"),
    call("command", "cat > /tmp/b.mts <<'EOF'\nx\nEOF"),
    call("command", "make"),
    call("command", "ls"),
    call("command", "pwd"),
  ]);
  expect(outline(pieces)).toEqual(["create", "run", "create", "Ran 3 commands: run, run, run"]);
  expect(pieces[0]).toMatchObject({ row: { ranToo: true } });
});

it("keeps a failed test and a passing one as two rows", () => {
  const pieces = traceTree([
    call("command", "npx vitest run a.test.ts", { detail: "FAIL a.test.ts" }),
    call("command", "npx vitest run a.test.ts", { detail: "Tests  3 passed" }),
  ]);
  expect(outline(pieces)).toEqual(["test", "test"]);
});

it("joins a file read again to its first read", () => {
  const [piece] = traceTree([
    call("command", "sed -n 1,10p a.css && sed -i '' 's/a/b/' a.css && sed -n 5,9p a.css"),
  ]);
  expect(piece).toMatchObject({ kind: "row", row: { action: { kind: "read" }, lines: ["1–10", "5–9"] } });
});

it("drops a re-read's lines once a read took the whole file", () => {
  const [piece] = traceTree([call("command", "sed -n 1,20p a.ts"), call("command", "cat a.ts")]);
  expect(piece?.kind === "row" && piece.row.lines).toBeUndefined();
});

it("says a test stopped before it finished stopped, not passed", () => {
  const [row] = rowsOf([call("command", "npm test", { status: "stopped" })]);
  expect(actionVerb(row!)).toBe("Tests stopped");
});

it("keeps a row's id when a call before it finishes and grows rows", () => {
  const running = call("command", "npm test && npm run lint", { status: "running" });
  const after = call("command", "rg foo src");
  const ids = (calls: AgentActivity[]) => rowsOf(calls).map((r) => r.id);
  expect(ids([running, after]).at(-1)).toBe(ids([{ ...running, status: "complete" }, after]).at(-1));
});

it("shows only the first part of a call still running", () => {
  const pieces = traceTree([call("command", "npm run typecheck && git commit -qm x", { status: "running" })]);
  expect(outline(pieces)).toEqual(["check"]);
});

it("keeps two pictures as two rows, each with its thumbnail", () => {
  expect(outline(traceTree([call("read", "a.png"), call("read", "b.png")]))).toEqual(["image", "image"]);
});

it("takes a script written and run in one command for one call", () => {
  const both = call("command", "cat > /tmp/check.py <<'EOF'\nprint(1)\nEOF\npython3 /tmp/check.py");
  const [piece] = traceTree([both]);
  expect(piece?.kind === "row" && piece.row).toMatchObject({ ranToo: true, calls: [both] });
});

it("counts a branch's commands as the rows under it, and git checks apart", () => {
  const oneLine = traceTree([call("command", "node a.js; python3 b.py; make build")]);
  expect(outline(oneLine)).toEqual(["Ran 3 commands: run, run, run"]);
  const looks = traceTree([call("command", "git status; git diff; ls; git log; git show HEAD")]);
  expect(outline(looks)).toEqual(["Checked git 4 times: git, git, git, git", "run"]);
});

it("folds a run of three lines or more into one, and leaves shorter ones be", () => {
  const short = [call("command", "grep -n a src/a.ts"), call("read", "src/a.ts")];
  expect(runSummary(short)).toBeUndefined();
  const long = [
    call("command", "grep -n a src/a.ts"),
    call("read", "src/a.ts"),
    call("command", "ls"),
    call("command", "grep -n b src/b.ts"),
    call("read", "src/b.ts"),
    call("command", "date"),
  ];
  expect(runSummary(long)).toBe("Searched twice, read 2 files and ran 2 commands");
});

it("names three kinds at most in a folded run's line", () => {
  const calls = [
    call("command", "grep -n a src/a.ts"),
    call("read", "src/a.ts"),
    call("command", "date"),
    call("command", "npm run lint"),
    call("command", "git commit -m 'x'"),
  ];
  expect(runSummary(calls)).toBe("Searched once, read 1 file and 3 more");
});

