// What shared/trace-tree.ts makes of sample runs, for the phone apps' tests to
// hold their ports to. The calls carry `actions` as a phone gets them.
//
//   node_modules/.bin/jiti scripts/trace-tree-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentActivity } from "../shared/projects";
import { callActions } from "../shared/call-actions";
import { readCode } from "../shared/read-code";
import {
  actionVerb,
  rowFailed,
  rowRunning,
  runSummary,
  showsOutput,
  shortPattern,
  shortWhere,
  traceTree,
  type TracePiece,
  type TraceRow,
} from "../shared/trace-tree";

const root = resolve(import.meta.dirname, "..");

let n = 0;
const call = (
  kind: AgentActivity["kind"],
  label: string,
  extra: Partial<AgentActivity> = {},
): AgentActivity => {
  const activity: AgentActivity = { id: `call-${++n}`, kind, label, status: "complete", ...extra };
  return { ...activity, actions: callActions(activity) };
};

const cases: { name: string; calls: AgentActivity[] }[] = [
  {
    name: "one line running three programs is one command",
    calls: [call("command", "node a.js; python3 b.py; make build")],
  },
  {
    name: "searches interleaved with a read",
    calls: [
      call("command", `grep -n "rg\\b\\|rgFlags" electron/agent-host/read-only-bash.ts | head -20; wc -l electron/agent-host/read-only-bash.ts`),
      call("command", `grep -rl "Activity" /tmp/audit/scripts/B /tmp/audit/scripts/B/cmd 2>/dev/null | head -3; grep -rh "Activity" /tmp/audit/scripts/B/cmd/*.mjs | head`),
      call("read", "electron/agent-host/read-only-bash.ts"),
      call("command", `grep -n "Activity" -B2 -A6 /tmp/audit/scripts/B/cmd/run15.mjs | head -30`),
    ],
  },
  {
    name: "scripts written to /tmp split the commands",
    calls: [
      call("file", "/tmp/f9/c8-views.mjs", { detail: "File created successfully at: /tmp/f9/c8-views.mjs" }),
      call("command", "sh /tmp/f9/run.sh /tmp/f9/c8-views.mjs"),
      call("command", "rg --version | head -1; rg --help | grep -oE 'x' > /tmp/rgflags.txt; cat > /tmp/rgcheck.mts <<'EOF'\nimport { readFileSync } from \"node:fs\";\nEOF"),
      call("command", "cd /tmp && mkdir -p rgneg && echo hi > rgneg/a.txt; for f in hidden follow; do rg --no-$f x rgneg; done"),
      call("command", `grep -rn "activity" src/features/sidebar/*.tsx | head`),
      call("file", "electron/agent-host/read-only-bash.ts"),
      call("command", "sed -n 160,180p src/features/sidebar/ProjectSidebar.tsx"),
      call("command", `sed -n 107,110p electron/agent-host/read-only-bash.ts; npx tsx /tmp/rgcheck.mts 2>&1 | grep -v "npm notice"; npx tsx /tmp/rgneg.mts | head -2`),
    ],
  },
  {
    name: "edits, a failing then passing test, git checks",
    calls: [
      call("file", "/tmp/f9/c8-views.mjs"),
      call("command", "sh /tmp/f9/run.sh /tmp/f9/c8-views.mjs"),
      call("command", `python3 - <<'EOF'\np="electron/agent-host/read-only-bash.ts"\ns=open(p).read()\ns=s.replace("a","b")\nopen(p,"w").write(s)\nEOF\ngrep -n "hostname-bin" electron/agent-host/read-only-bash.test.ts | head -30`),
      call("read", "electron/agent-host/read-only-bash.test.ts"),
      call("command", `python3 - <<'EOF'\np="electron/agent-host/read-only-bash.test.ts"\ns=open(p).read()\ns=s.replace("x","y",1)\nEOF`),
      call("command", "npx vitest run electron/agent-host/read-only-bash.test.ts 2>&1 | tail -20", {
        detail: " FAIL  electron/agent-host/read-only-bash.test.ts > lets reads through\n Test Files  1 failed (1)",
      }),
      call("command", `grep -n "const disguised" -A4 electron/agent-host/read-only-bash.ts; sed -i '' "s/a/b/" electron/agent-host/read-only-bash.test.ts && npx vitest run electron/agent-host/read-only-bash.test.ts 2>&1 | tail -3`, {
        detail: " Test Files  1 passed (1)\n      Tests  12 passed (12)",
      }),
      call("command", "git log --format='%h %s' -- electron/agent-host/read-only-bash.ts | tail -3; git show 02111667:electron/agent-host/read-only-bash.ts | grep -n disg"),
    ],
  },
  {
    name: "a file read twice, a commit, and two pictures",
    calls: [
      call("command", "sed -n 890,900p src/features/sidebar/sidebar.css && sed -i '' '898s/.*/  color: var(--muted);/' src/features/sidebar/sidebar.css && sed -n 892,900p src/features/sidebar/sidebar.css"),
      call("command", `git add src/features/sidebar/sidebar.css && git commit -q -m "Show the branch line in muted grey" && git log --oneline -1`, {
        detail: "4484e535 Show the branch line in muted grey",
      }),
      call("read", "/tmp/shots/dim-light.png"),
      call("read", "/tmp/shots/dim-dark.png"),
    ],
  },
  {
    name: "a run still going",
    calls: [
      call("command", `bash -c "printf '[%s] ' rg x"`),
      call("command", `npm run typecheck >/tmp/tc.txt 2>&1; echo "tc $?"; git add a.ts && git commit -qm "Let rg take its flags"`, { status: "running" }),
    ],
  },
  {
    name: "tools, agents, the web and a failed read",
    calls: [
      call("search", "useThreadScroll in src"),
      call("search", "thread-scroll in tests"),
      call("web", "shiki line diff"),
      call("agent", "Find the scroll code"),
      call("agent", "Check the phone apps"),
      call("tool", "relay: screenshot"),
      call("read", "src/missing.ts", { status: "failed" }),
      call("read", "src/app/shell.css"),
    ],
  },
  {
    name: "a stopped test, a file read in part then whole, a row behind a running call",
    calls: [
      call("command", "npm test", { status: "stopped" }),
      call("command", "sed -n 1,20p src/a.ts"),
      call("command", "cat src/a.ts"),
      call("command", "git status && npm run lint", { status: "running" }),
      call("command", "rg foo src"),
    ],
  },
  {
    name: "one call that searched, read and printed three files",
    calls: [call("command", "rg foo src && sed -n 1,40p src/a.ts"), call("command", "cat src/b.ts src/c.ts src/d.ts")],
  },
  {
    name: "a script written, then running",
    calls: [
      call("file", "/tmp/a.mjs", { detail: "File created successfully at: /tmp/a.mjs" }),
      call("command", "node /tmp/a.mjs", { status: "running" }),
    ],
  },
  {
    name: "a patch that deleted one file and edited another, then two deletes",
    calls: [
      call("file", "src/old.ts +1 more", {
        detail: "src/old.ts\nsrc/a.ts",
        written: [
          { kind: "swap", path: "src/old.ts", edits: [{ old: "export {};", new: "" }], deleted: true },
          { kind: "patch", path: "src/a.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" },
        ],
      }),
      call("file", "src/b.ts", { written: [{ kind: "swap", path: "src/b.ts", edits: [{ old: "b", new: "" }], deleted: true }] }),
      call("file", "src/c.ts", { written: [{ kind: "swap", path: "src/c.ts", edits: [{ old: "c", new: "" }], deleted: true }] }),
    ],
  },
  {
    name: "git checks on a branch of their own, beside other commands",
    calls: [call("command", "git status; git diff; ls; git log; git show HEAD")],
  },
];

const quiet = (r: TraceRow) => r.calls.filter((c) => !showsOutput(r, c)).map((c) => c.id);

const row = (r: TraceRow) => ({
  id: r.id,
  action: r.action,
  calls: r.calls.map((c) => c.id),
  ...(r.lines ? { lines: r.lines } : {}),
  ...(r.ranToo ? { ranToo: true } : {}),
  // Calls whose output another of their rows shows.
  ...(quiet(r).length ? { quiet: quiet(r) } : {}),
  failed: rowFailed(r),
  running: rowRunning(r),
  verb: actionVerb(r),
  liveVerb: actionVerb(r, true),
});

const piece = (p: TracePiece) => {
  switch (p.kind) {
    case "row":
      return { kind: "row", row: row(p.row) };
    case "pair":
      return { kind: "pair", rows: p.rows.map(row) };
    case "branch":
      return { kind: "branch", branch: p.branch, heading: p.heading, rows: p.rows.map(row) };
  }
};

const reads = [
  call("command", "/bin/zsh -lc 'sed -n 115,117p pages/Player.jsx'", { detail: "a\nb\nc\n" }),
  call("command", "sed -n 115,135p pages/Player.jsx", { detail: "a\nb\n" }),
  call("read", "src/a.ts", { detail: "10\tconst a = 1;\n11\t\n12\tconst b = 2;\n\n<system-reminder>\nmalware\n</system-reminder>" }),
  call("read", "src/a.ts", { detail: "6\tnd of a long line\n117\tnext();\n118\tdone();" }),
  call("command", "/bin/zsh -lc \"nl -ba electron/main.ts | sed -n '40,41p'\"", { detail: "    40\tapp.on();\n    41\tquit();\n" }),
  call("command", "cat data.tsv", { detail: "1\tann\n2\tbob\nname\tage\nx\ty\nz\tw" }),
  call("command", "cat ids.tsv", { detail: "001\tann\n002\tbob\n003\tcam" }),
  call("command", "cat -n src/b.ts", { detail: "     1\tx\n     2\ty" }),
  call("command", "nl src/c.ts", { detail: "     1\tone\n     2\ttwo\n       \n     3\tthree\n     4\tfour\n" }),
  call("command", "sed -n 1,2p a.ts; sed -n 1,2p b.ts", { detail: "x\ny\nz\nw" }),
  call("command", "cat missing.ts", { detail: "No such file", status: "failed" }),
];

const fixture = {
  cases: cases.map((c) => ({
    name: c.name,
    calls: c.calls,
    pieces: traceTree(c.calls).map(piece),
    summary: runSummary(c.calls) ?? null,
  })),
  shortPatterns: ["^\\.sb-age\\b\\|^\\.sb-age {", "rg\\b\\|rgFlags", "color: color-mix(in srgb, var(--muted) 70%, transparent);", "plain"].map(
    (p) => [p, shortPattern(p)],
  ),
  readCodes: reads.map((c) => ({ call: c, read: readCode(c) ?? null })),
  shortWheres: ["src", "/private/tmp/relay-audit/scripts/B /tmp/x", "src/features/sidebar/*.tsx"].map((w) => [w, shortWhere(w)]),
};

for (const path of [
  "ios/RelayKit/Tests/RelayRemoteTests/Fixtures/ts-trace-tree.json",
  "android/app/src/test/resources/ts-trace-tree.json",
]) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(fixture, null, 1) + "\n");
}
