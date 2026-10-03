// Sample threads for the unread-marker preview. Times are relative to when
// the page loads, so the "since" labels read like a real afternoon.
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
} from "../../shared/projects";

export const projectRoot = "/Users/you/code/relay";
const p = (path: string) => `${projectRoot}/${path}`;
const min = 60 * 1000;
const loaded = Date.now();
const ago = (minutes: number) => loaded - minutes * min;

type Step =
  | { text: string }
  | { kind: AgentActivity["kind"]; label: string; status?: "failed" };

let traceId = 0;
export function trace(steps: Step[], runningLast = false): AgentTrace[] {
  return steps.map((step, i) => {
    const id = `t${++traceId}`;
    if ("text" in step) return { kind: "commentary", id, text: step.text };
    const running = runningLast && i === steps.length - 1;
    return {
      kind: "activity",
      id,
      activity: {
        id,
        kind: step.kind,
        label: step.label,
        status: running ? "running" : (step.status ?? "complete"),
      },
    };
  });
}

const model = { name: "Opus 5.5", effort: "high" } as const;

function user(id: string, at: number, body: string): ChatMessage {
  return {
    id,
    role: "user",
    body,
    status: "complete",
    created: at,
    provider: "claude",
    version: 1,
  };
}

function answer(
  id: string,
  at: number,
  ended: number,
  steps: Step[],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    body,
    status: "complete",
    created: at,
    ended,
    provider: "claude",
    model,
    trace: trace(steps),
    version: 1,
    ...extra,
  };
}

/** The thread the marker is about: you sent m3 and walked away. */
const flaky: ChatMessage[] = [
  user(
    "m1",
    ago(62),
    "`tests/e2e/worktrees.spec.ts` fails about one run in five on the mini. Find out why and fix it. Don't just bump the timeout.",
  ),
  answer(
    "m2",
    ago(61),
    ago(52),
    [
      { text: "Reading the spec and the worktree helpers." },
      { kind: "read", label: p("tests/e2e/worktrees.spec.ts") },
      { kind: "read", label: p("electron/git/worktrees.ts") },
      { kind: "search", label: "worktree list --porcelain" },
      {
        kind: "command",
        label: "npx playwright test tests/e2e/worktrees.spec.ts --repeat-each 20",
      },
      { text: "4 of 20 failed, all at the same step." },
      { kind: "read", label: p("electron/git/watch.ts") },
      { kind: "file", label: p("electron/git/worktrees.ts") },
      { kind: "file", label: p("tests/e2e/worktrees.spec.ts") },
      {
        kind: "command",
        label: "npx playwright test tests/e2e/worktrees.spec.ts --repeat-each 20",
      },
    ],
    "Found it. The spec clicks **Move to worktree** before `git worktree add` has finished writing `.git/worktrees/<name>/HEAD`, and the watcher in `electron/git/watch.ts` reads the half-written file and reports the branch as detached.\n\n- `addWorktree` now waits for `git worktree add` to exit before it emits `worktrees-changed`.\n- The spec waits for the branch label instead of a fixed 500 ms.\n\n20 of 20 runs pass now; before it was 16 of 20.",
    {
      changes: [
        { path: "electron/git/worktrees.ts", additions: 14, deletions: 5 },
        { path: "tests/e2e/worktrees.spec.ts", additions: 6, deletions: 9 },
      ],
    },
  ),
  user(
    "m3",
    ago(48),
    "Nice. Do the same for the handback path, then run the whole worktree group 50 times in the background. I'm heading out, leave me a summary.",
  ),
  answer(
    "m4",
    ago(47.8),
    ago(31),
    [
      { kind: "read", label: p("electron/project-chats/handback.ts") },
      { kind: "search", label: 'emit("worktrees-changed"' },
      { kind: "file", label: p("electron/project-chats/handback.ts") },
      {
        kind: "command",
        label:
          "npx playwright test tests/e2e/worktrees.spec.ts tests/e2e/move-to-worktree.spec.ts --repeat-each 50 > /tmp/relay-e2e/worktrees-50x.log &",
      },
      { text: "Started the 50× run in the background; it takes about 20 minutes." },
    ],
    "The handback path had the same race: `returnToCheckout` emitted `worktrees-changed` from inside the `git worktree remove` callback. It now waits for the remove to exit, same as `addWorktree`.\n\nThe 50× run of both worktree specs is going in the background. I'll pick it up when it finishes.",
    {
      changes: [
        {
          path: "electron/project-chats/handback.ts",
          additions: 9,
          deletions: 4,
        },
      ],
    },
  ),
  answer(
    "m5",
    ago(12),
    ago(10),
    [
      { kind: "read", label: "/tmp/relay-e2e/worktrees-50x.log" },
      { kind: "command", label: "grep -c ' passed' /tmp/relay-e2e/worktrees-50x.log" },
    ],
    "The background run finished: **100 of 100** passed across both specs, 18 m 40 s in all.\n\nWhile you were out:\n\n1. `addWorktree` and `returnToCheckout` both wait for git to exit before telling the app the worktrees changed.\n2. Both specs wait for the branch label instead of sleeping.\n3. No flakes in 100 runs. The three files are uncommitted on `main`.",
    { unprompted: true },
  ),
];

const outbox: ChatMessage[] = [
  user(
    "o1",
    ago(190),
    "When the phone loses the bridge mid-send, the message just vanishes. Queue it and retry when we're back.",
  ),
  answer(
    "o2",
    ago(189),
    ago(176),
    [
      { kind: "read", label: p("phone/src/bridge/send.ts") },
      { kind: "file", label: p("phone/src/bridge/outbox.ts") },
      { kind: "file", label: p("phone/src/bridge/send.ts") },
      { kind: "command", label: "npx vitest run phone/src/bridge" },
    ],
    "Sends now go through an outbox in `phone/src/bridge/outbox.ts`. A send that fails on a dropped bridge stays in it, shown greyed with *Waiting for desktop*, and goes out in order when the bridge reconnects. The bridge tests cover a drop mid-send and a reconnect with three waiting.",
  ),
];

const electron: ChatMessage[] = [
  user("e1", ago(400), "Bump Electron to 39 and tell me what breaks."),
  answer(
    "e2",
    ago(399),
    ago(380),
    [
      { kind: "file", label: p("package.json") },
      { kind: "command", label: "npm install" },
      { kind: "command", label: "npm run typecheck" },
      { kind: "command", label: "npx playwright test tests/e2e/desktop.spec.ts" },
    ],
    "Electron 39 is in. Typecheck is clean and the desktop spec passes. The only change it needed was `webContents.getPrinters` → `getPrintersAsync` in the share dialog, which we don't call any more anyway, so I removed the dead import.",
  ),
];

export interface SampleThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export const sampleThreads: SampleThread[] = [
  { id: "flaky", title: "Fix the flaky worktrees spec", messages: flaky },
  { id: "outbox", title: "Phone outbox retries", messages: outbox },
  { id: "electron", title: "Bump Electron to 39", messages: electron },
];

/** You read everything in a thread up to here; for the flaky one, up to your m3. */
export const initialSeen: Record<string, number> = {
  flaky: ago(48) + 5000,
  outbox: ago(176),
  electron: ago(380),
};

/** What a newly arriving answer says, in turn; each lands in the flaky thread. */
export const arrivals: { steps: Step[]; body: string }[] = [
  {
    steps: [
      { kind: "command", label: "git status --short" },
      { kind: "command", label: "git diff --stat" },
    ],
    body: "Checked back as scheduled. Nothing else touched the worktree files since the run; the three changes are still uncommitted and `git diff --stat` matches the summary above.",
  },
  {
    steps: [
      { kind: "read", label: p("scripts/mini-ci/run.sh") },
      { kind: "command", label: "ssh you@mac-mini.local 'tail -n 20 ~/ci/last.log'" },
    ],
    body: "The mini's nightly run picked up the fix: `worktrees.spec.ts` passed on all three platforms, first green night for it this week.",
  },
  {
    steps: [{ kind: "command", label: "npm run typecheck" }],
    body: "Typecheck is clean across all four projects with the handback change in.",
  },
];
