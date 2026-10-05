// What the app's components ask the desktop for, answered from sample data.
// Two answers change while the page plays: the reviewers' hidden threads
// during a deep review, and the project's running processes once the
// terminal demo starts a dev server.
import type { Api } from "../../shared/types";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import type { ProjectTask } from "../../shared/tasks";
import { defaultAISettings } from "../../shared/settings";
import { VERSION } from "./content";
import { chats, trace, type Step } from "./sample";

/** Set by the demos as they play. */
export const playing = {
  /** When the deep review's reviewers started, 0 before that. */
  reviewStarted: 0,
  /** The terminal demo's dev server is up. */
  serving: false,
};

const loaded = Date.now();
const p = (path: string) => `/Users/you/relay/${path}`;

const reviewers: Record<string, { provider: ChatMessage["provider"]; steps: Step[]; body: string }> = {
  "rev-1": {
    provider: "claude",
    steps: [
      { kind: "command", label: "git diff HEAD --stat" },
      { kind: "read", label: p("src/features/thread/ProjectChat.tsx") },
      { kind: "read", label: p("src/app/ProjectShell.tsx") },
      { kind: "search", label: "queue.splice(" },
      { kind: "read", label: p("src/features/thread/waiting-strip.css") },
      { kind: "command", label: "npx vitest run src/features/thread" },
    ],
    body: "4 findings.\n\n- **P1** Reordering the queue can drop a message\n- **P1** Thread keeps its PR scope after switching branch\n- **P2** Waiting strip keeps animating when the window is unfocused\n- **P3** Unused import in ProjectShell",
  },
  "rev-2": {
    provider: "codex",
    steps: [
      { kind: "command", label: "git status --short" },
      { kind: "read", label: p("src/features/thread/ProjectChat.tsx") },
      { kind: "read", label: p("src/features/composer/PastedTextCard.tsx") },
      { kind: "search", label: "useUnread(" },
      { kind: "read", label: p("src/features/thread/waiting-strip.css") },
    ],
    body: "3 findings.\n\n- **P1** Queue reorder drops a message\n- **P2** A pasted text card disappears on reload\n- **P2** Missing null check in useUnread",
  },
};

/** A reviewer's hidden thread as it stands now: a step a second, then its findings. */
function reviewerChat(id: string): ProjectChat {
  const reviewer = reviewers[id];
  const started = playing.reviewStarted || Date.now();
  const shown = Math.floor((Date.now() - started) / 900) + 1;
  const done = shown > reviewer.steps.length;
  return {
    id,
    title: "Reviewer",
    projectId: "relay",
    scope: { kind: "project" },
    created: started,
    updated: Date.now(),
    branch: "main",
    messages: [
      {
        id: `${id}-ask`,
        role: "user",
        body: "/code-review the uncommitted changes",
        status: "complete",
        created: started,
        provider: reviewer.provider,
        version: 1,
      },
      {
        id: `${id}-answer`,
        role: "assistant",
        body: done ? reviewer.body : "",
        status: done ? "complete" : "streaming",
        created: started + 400,
        ended: done ? started + reviewer.steps.length * 900 : undefined,
        provider: reviewer.provider,
        model: { name: "", byDefault: true, effort: "high" },
        trace: trace(reviewer.steps.slice(0, shown), !done),
        version: 1,
      },
    ],
  } as ProjectChat;
}

function tasks(): ProjectTask[] {
  const list: ProjectTask[] = [
    {
      id: "t1",
      command: "npx vitest --watch src/lib",
      kind: "test",
      title: "Vitest watch",
      agent: "claude",
      origin: "relay",
      chatId: "shortcuts",
      started: loaded - 9 * 60_000,
      ports: [],
      pids: 1,
    },
    {
      id: "t2",
      command: "docker compose up db",
      kind: "container",
      title: "docker compose up db",
      origin: "detached",
      started: loaded - 3 * 60 * 60_000,
      ports: [5432],
      pids: 1,
    },
  ];
  if (playing.serving)
    list.unshift({
      id: "t3",
      command: "npm run dev",
      kind: "server",
      title: "Vite dev server",
      origin: "terminal",
      chatId: "shortcuts",
      started: Date.now() - 2000,
      ports: [5177],
      pids: 1,
    });
  return list;
}

export function installStubs() {
  // The Running panel opens folded to its count; the shell demo unfolds it.
  localStorage.setItem("relay-tasks-collapsed", "true");
  Object.assign(window.relay, {
    projectChats: async (id: string) => chats.filter((c) => c.projectId === id),
    projectChat: async (id: string) => reviewerChat(id),
    scratchChats: async () => [],
    projectGroups: async () => [],
    updateState: async () => ({ status: "off", current: VERSION }),
    onUpdate: () => () => {},
    agentVersions: async () => ({ agents: [], checking: false }),
    onAgentVersions: () => () => {},
    onProjectChat: () => () => {},
    triageProjectChat: async () => {},
    aiSettings: async () => defaultAISettings,
    projectCommands: async () => [],
    projectBranches: async () => ({ branches: [], bases: [] }),
    projectTasks: async (id: string) => (id === "relay" ? tasks() : []),
    stopProjectTask: async () => {},
    restartProjectTask: async () => {},
    openExternal: async () => {},
  } satisfies Partial<Record<keyof Api, unknown>>);
}
