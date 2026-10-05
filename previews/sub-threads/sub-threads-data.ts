// Sample threads for the started-threads preview: one thread that started
// four others over Relay's MCP tools, and a few unrelated ones around it.
import type { MessageProvider } from "../../src/features/agents/model-picker-catalog";

export type Live = "working" | "waiting" | "done" | "stopped" | "unread" | "idle";

export interface SampleThread {
  id: string;
  project: string;
  hue: number;
  title: string;
  provider: MessageProvider;
  model: string;
  branch?: string;
  live: Live;
  /** Minutes ago it last changed, or how long a started one has run. */
  age: number;
  /** The thread that started it. */
  parent?: string;
  /** What the parent asked it to do. */
  task?: string;
  /** Its latest line: what it's on, what it asks, or how it ended. */
  now?: string;
}

export const threads: SampleThread[] = [
  {
    id: "lead",
    project: "Relay",
    hue: 250,
    title: "Competitor research follow-ups",
    provider: "claude",
    model: "Opus 5.5",
    branch: "main",
    live: "idle",
    age: 1,
  },
  {
    id: "boot",
    project: "Relay",
    hue: 250,
    title: "Worktree bootstrap: .worktreeinclude and setup",
    provider: "codex",
    model: "GPT-5.5",
    branch: "relay/worktree-bootstrap",
    live: "waiting",
    age: 7,
    parent: "lead",
    task: "Honour .worktreeinclude when Relay makes a worktree, and add per-project setup and teardown commands under Settings → Projects. Run the setup in the new worktree before the agent starts.",
    now: "Asks: should setup run before or after the ignored files are copied in?",
  },
  {
    id: "branch",
    project: "Relay",
    hue: 250,
    title: "Branch name on new worktree threads",
    provider: "claude",
    model: "Sonnet 5.5",
    branch: "relay/branch-name",
    live: "done",
    age: 4,
    parent: "lead",
    task: "Let the user type the branch name when a thread starts in a worktree. Prefill it with today's relay/<slug>.",
    now: "Done: the field sits under the worktree toggle, prefilled; tests pass.",
  },
  {
    id: "width-a",
    project: "Relay",
    hue: 250,
    title: "Chat width setting",
    provider: "claude",
    model: "Sonnet 5.5",
    branch: "relay/chat-width",
    live: "done",
    age: 3,
    parent: "lead",
    task: "Add a chat width setting under Appearance; --thread-width is fixed at 1040px today.",
    now: "Done: a slider under Appearance, 720–1600px, live while dragging.",
  },
  {
    id: "width-b",
    project: "Relay",
    hue: 250,
    title: "Chat width setting",
    provider: "cursor",
    model: "Composer 2",
    branch: "relay/chat-width-2",
    live: "working",
    age: 6,
    parent: "lead",
    task: "Add a chat width setting under Appearance; --thread-width is fixed at 1040px today.",
    now: "Editing src/features/settings/sections/appearance.tsx",
  },
  {
    id: "invoice",
    project: "Licensing",
    hue: 150,
    title: "Seat count on renewal invoices",
    provider: "codex",
    model: "GPT-5.5",
    branch: "fix/seat-count",
    live: "unread",
    age: 42,
  },
  {
    id: "hero",
    project: "Website",
    hue: 28,
    title: "Pricing page hero spacing",
    provider: "claude",
    model: "Sonnet 5.5",
    live: "idle",
    age: 95,
  },
];
