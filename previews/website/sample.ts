// Sample threads, answers, limits and a review for the website's live demos.
// The shapes are the app's own, so its real components draw them.
import type { AgentActivity, AgentTrace, ChatMessage, ChatSummary, Project } from "../../shared/projects";
import type { DeepReviewState } from "../../shared/deep-review";

export const projectRoot = "/Users/you/relay";
const p = (path: string) => `${projectRoot}/${path}`;
const minute = 60_000;
const loaded = Date.now();

export const projects: Project[] = ["relay", "website", "api"].map((name, i) => ({
  id: name,
  name,
  path: `/Users/you/${name}`,
  repository: null,
  added: i,
}));

const chat = (c: Partial<ChatSummary> & Pick<ChatSummary, "id" | "title">) =>
  ({
    projectId: "relay",
    scope: { kind: "project" },
    created: loaded - 40 * minute,
    updated: loaded - minute,
    branch: "main",
    ...c,
  }) as ChatSummary;

export const chats: ChatSummary[] = [
  chat({
    id: "shortcuts",
    title: "Jump between threads with ⌘1–9",
    running: true,
    runningSince: loaded - 0.6 * minute,
    runningAgents: ["claude"],
  }),
  chat({
    id: "review",
    title: "Deep review · Uncommitted changes",
    provider: "claude",
    running: true,
    runningSince: loaded - 3 * minute,
    runningAgents: ["claude", "codex"],
  }),
  chat({
    id: "hero",
    projectId: "website",
    title: "Hero section for the launch page",
    branch: "launch-hero",
    provider: "codex",
    updated: loaded - 2 * minute,
  }),
  chat({
    id: "split",
    title: "Split project-chats.ts into modules",
    branch: "split-chats",
    provider: "claude",
    running: true,
    waiting: true,
    runningSince: loaded - 6 * minute,
    runningAgents: ["claude"],
  }),
  chat({
    id: "limits",
    projectId: "api",
    title: "Rate-limit the upload endpoint",
    branch: "upload-limits",
    provider: "opencode",
    updated: loaded - 55 * minute,
  }),
];

export type Step = { text: string } | { kind: AgentActivity["kind"]; label: string };

let traceId = 0;
export function trace(steps: Step[], runningLast = false): AgentTrace[] {
  return steps.map((step, i) => {
    const id = `t${++traceId}`;
    if ("text" in step) return { kind: "commentary", id, text: step.text };
    return {
      kind: "activity",
      id,
      activity: {
        id,
        kind: step.kind,
        label: step.label,
        status: runningLast && i === steps.length - 1 ? "running" : "complete",
      },
    };
  });
}

function user(id: string, minutesAgo: number, body: string, provider: ChatMessage["provider"] = "claude"): ChatMessage {
  return { id, role: "user", body, status: "complete", created: loaded - minutesAgo * minute, provider, version: 1 };
}

export interface Turn {
  prompt: ChatMessage;
  provider: ChatMessage["provider"];
  model: NonNullable<ChatMessage["model"]>;
  steps: Step[];
  body: string;
  changes: NonNullable<ChatMessage["changes"]>;
  /** How long the finished turn says it worked. */
  seconds: number;
}

export const turns: Record<string, Turn> = {
  shortcuts: {
    prompt: user("s1", 1, "Let me jump to the Nth thread in Activity with ⌘1–9. Show the numbers while ⌘ is held."),
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    steps: [
      { text: "Looking at how shortcuts are registered today." },
      { kind: "read", label: p("shared/shortcuts.ts") },
      { kind: "search", label: "registerShortcut" },
      { kind: "read", label: p("src/features/sidebar/SidebarActivity.tsx") },
      { kind: "file", label: p("shared/shortcuts.ts") },
      { kind: "file", label: p("src/features/sidebar/useActivityKeys.ts") },
      { kind: "command", label: "npx vitest run src/lib/shortcuts.test.ts" },
    ],
    body: "Added **⌘1–9** to open the Nth card in Activity. Holding ⌘ for a moment shows the numbers on the cards, so you can see where each one goes.\n\nThe binding lives in `shared/shortcuts.ts` next to ⌘N, so it can be rebound in Settings. All 14 tests pass.",
    changes: [
      { path: "shared/shortcuts.ts", additions: 24, deletions: 3 },
      { path: "src/features/sidebar/useActivityKeys.ts", additions: 41, deletions: 0 },
      { path: "src/lib/shortcuts.test.ts", additions: 38, deletions: 0 },
    ],
    seconds: 38,
  },
  hero: {
    prompt: user("h1", 9, "Build the hero section for the launch page from the notes in launch-notes.md.", "codex"),
    provider: "codex",
    model: { name: "GPT-5.6-Sol", effort: "high" },
    steps: [
      { kind: "read", label: "/Users/you/website/launch-notes.md" },
      { kind: "read", label: "/Users/you/website/src/sections/Hero.tsx" },
      { kind: "file", label: "/Users/you/website/src/sections/Hero.tsx" },
      { kind: "file", label: "/Users/you/website/src/sections/hero.css" },
      { kind: "command", label: "npm run typecheck" },
    ],
    body: "The hero is in: headline, two actions and the product shot. Under 760px it collapses to one column. Typecheck is clean.",
    changes: [
      { path: "src/sections/Hero.tsx", additions: 62, deletions: 18 },
      { path: "src/sections/hero.css", additions: 41, deletions: 0 },
    ],
    seconds: 72,
  },
  limits: {
    prompt: user("l1", 58, "Rate-limit the upload endpoint to 20 requests a minute per token.", "opencode"),
    provider: "opencode",
    model: { name: "", byDefault: true, effort: "", effortByDefault: true },
    steps: [
      { kind: "read", label: "/Users/you/api/server/routes/upload.ts" },
      { kind: "search", label: "rateLimit(" },
      { kind: "file", label: "/Users/you/api/server/routes/upload.ts" },
      { kind: "file", label: "/Users/you/api/server/routes/upload.test.ts" },
      { kind: "command", label: "npx vitest run server/routes/upload.test.ts" },
    ],
    body: "Uploads go through the existing limiter at 20 a minute per token and answer `429` with `Retry-After` past that. Two new tests cover the limit and the reset.",
    changes: [
      { path: "server/routes/upload.ts", additions: 17, deletions: 1 },
      { path: "server/routes/upload.test.ts", additions: 29, deletions: 0 },
    ],
    seconds: 52,
  },
  split: {
    prompt: user("p1", 7, "Split project-chats.ts into modules. Keep the public API where it is."),
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    steps: [
      { kind: "read", label: p("electron/project-chats/project-chats.ts") },
      { kind: "search", label: "from \"./project-chats\"" },
      { kind: "command", label: "git mv electron/project-chats/project-chats.ts electron/project-chats/store.ts" },
    ],
    body: "",
    changes: [],
    seconds: 0,
  },
  review: {
    prompt: user("r1", 3, "Deep review the uncommitted changes."),
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    steps: [
      { kind: "command", label: "git diff" },
      { kind: "read", label: p("shared/shortcuts.ts") },
      { kind: "read", label: p("src/features/sidebar/useActivityKeys.ts") },
    ],
    body: "",
    changes: [],
    seconds: 0,
  },
};

/** A turn as the thread shows it `shown` steps in; past the last step it has finished. */
export function turnMessages(id: string, shown: number): ChatMessage[] {
  const turn = turns[id];
  const done = shown > turn.steps.length;
  const created = turn.prompt.created + 2000;
  return [
    turn.prompt,
    {
      id: `${id}-answer`,
      role: "assistant",
      body: done ? turn.body : "",
      status: done ? "complete" : "streaming",
      created,
      ended: done ? created + turn.seconds * 1000 : undefined,
      provider: turn.provider,
      model: turn.model,
      trace: trace(turn.steps.slice(0, Math.max(1, shown)), !done),
      changes: done ? turn.changes : undefined,
      version: 1,
    },
  ];
}

const choice = { model: "", fast: false, reasoningEffort: "high" } as const;

export const review: DeepReviewState = {
  request: "r1",
  scope: { target: { kind: "uncommitted" }, label: "Uncommitted changes", branch: "main" },
  reviewers: [
    { provider: "claude", choice: { ...choice, model: "claude-opus-5-5" }, chatId: "rev-1" },
    { provider: "codex", choice: { ...choice, model: "GPT-5.6-Sol" }, chatId: "rev-2" },
  ],
  lead: { provider: "claude", choice: { ...choice, model: "claude-opus-5-5" } },
  runChecks: true,
  runtimeMode: "full-access" as DeepReviewState["runtimeMode"],
  status: "done",
  report: {
    messageId: "r2",
    findings: [
      {
        id: "F1",
        priority: "P1",
        title: "Reordering the queue can drop a message",
        files: [{ path: "src/features/thread/ProjectChat.tsx", line: 895 }],
        reviewers: [1, 2],
        check: "Reproduced with two queued messages: moving the second above the first while the first sends loses it.",
      },
      {
        id: "F2",
        priority: "P1",
        title: "Thread keeps its PR scope after switching branch",
        files: [
          { path: "src/app/ProjectShell.tsx", line: 199 },
          { path: "src/features/thread/ProjectChat.tsx", line: 456 },
        ],
        reviewers: [1],
        check: "The scope is read once on mount and never again.",
      },
      {
        id: "F3",
        priority: "P2",
        title: "Waiting strip keeps animating when the window is unfocused",
        files: [{ path: "src/features/thread/waiting-strip.css", line: 12 }],
        reviewers: [1, 2],
      },
      {
        id: "F4",
        priority: "P2",
        title: "A pasted text card disappears on reload",
        files: [{ path: "src/features/composer/PastedTextCard.tsx", line: 48 }],
        reviewers: [2],
      },
    ],
    dropped: [
      { title: "Missing null check in useUnread", reason: "The caller already guards it.", reviewers: [2] },
      { title: "Queue reorder drops a message", reason: "Same as F1.", reviewers: [2] },
      { title: "Unused import in ProjectShell", reason: "It is used by the type on line 31.", reviewers: [1] },
    ],
  },
};
