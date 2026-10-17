// What shared/activity-labels.ts and shared/agent-trace.ts give for sample
// turns, for RelayKit's tests to hold the Swift port to.
//
//   node_modules/.bin/jiti ios/scripts/trace-fixtures.ts
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const labels = await import(join(root, "shared/activity-labels.ts"));
const trace = await import(join(root, "shared/agent-trace.ts"));

let n = 0;
const call = (kind: string, label: string, status = "complete", extra: object = {}) => ({
  id: `call-${++n}`,
  kind,
  label,
  status,
  ...extra,
});

const commands = [
  "rg foo src",
  "cd app && npx vitest run",
  "/bin/zsh -lc 'rg -n \"x\" .'",
  "bash -c \"cd web && npm test\"",
  "FOO=1 sudo env BAR=2 make build",
  "for f in *.ts; do eslint $f; done",
  "if [ -f x ]; then cat x; fi",
  "export A=1; ./scripts/run.sh --fast",
  "cd only",
  "(git status)",
];

const activities = [
  call("command", "npm run build"),
  call("command", "rg needle", "failed"),
  call("command", "sleep 5", "stopped"),
  call("command", "npm test", "running"),
  call("read", "src/app/AgentTurn.tsx"),
  call("read", "README.md", "failed"),
  call("file", "src/a.ts"),
  call("file", "src/b.ts +2 more", "complete", { detail: "src/b.ts\nsrc/c.ts\nsrc/d.ts" }),
  call("search", "useThreadScroll"),
  call("web", "swift regex lookahead"),
  call("agent", "Explore the bridge"),
  call("tool", "relay: start_threads"),
  call("tool", "AskUserQuestion", "complete", { detail: 'The user answered: "Port?"="5178", "Runner?"="vitest". Carry on.' }),
  call("tool", "AskUserQuestion", "failed"),
  call("tool", "request_user_input", "complete", { questionAnswers: [{ question: "A?", answer: "b" }] }),
];

const summaries = [
  [activities[0], activities[0], activities[4], activities[4], activities[6], activities[7]],
  [activities[0], activities[1], activities[2], activities[3]],
  [activities[8], activities[9], activities[10], activities[11], activities[12], activities[14]],
  [activities[6]],
  [],
].map((list) => ({ ids: list.map((a) => a.id), text: labels.summarizeActivity(list) }));
const dropped = { ids: [activities[0].id], dropped: { command: 4, failed: 2 }, text: labels.summarizeActivity([activities[0]], { command: 4, failed: 2 }) };

const entries = [
  { kind: "commentary", id: "c1", text: "Looking around." },
  { kind: "activity", id: activities[0].id, activity: activities[0] },
  { kind: "activity", id: activities[4].id, activity: activities[4] },
  { kind: "activity", id: activities[12].id, activity: activities[12] },
  { kind: "activity", id: activities[6].id, activity: activities[6] },
  { kind: "commentary", id: "c2", text: "Done." },
  { kind: "activity", id: activities[8].id, activity: activities[8] },
];

const fixture = {
  activities,
  commands: commands.map((c) => [c, labels.programName(c) ?? null]),
  labels: activities.map((a) => ({ id: a.id, done: labels.doneLabel(a), live: labels.liveLabel(a) })),
  summaries: [...summaries, dropped],
  durations: [0, 999, 59_999, 60_000, 184_500].map((ms) => [ms, labels.duration(ms)]),
  entries,
  groups: trace.groupTrace(entries).map((p: any) => (p.kind === "run" ? { run: p.activity.map((a: any) => a.id) } : { commentary: p.id })),
  words: ["a", "44444444-4444-4444-8444-000000000005", "ünï"].flatMap((seed) =>
    [0, 6000, 1_792_170_922_897].map((now) => [seed, now, trace.thinkingWord(seed, now)]),
  ),
};
writeFileSync(join(root, "ios/RelayKit/Tests/RelayRemoteTests/Fixtures/ts-trace.json"), JSON.stringify(fixture, null, 1) + "\n");
