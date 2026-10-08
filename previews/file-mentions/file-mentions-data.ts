// Sample data: Relay's own source stands in for the project, so the files to
// search and peek at are real. The thread and its changes are made up.
import type { ChatMessage, ChatSummary, Project } from "../../shared/projects";
import type { WorkingTree } from "../../shared/working-tree";

const sources = import.meta.glob(
  "../../{src,shared,electron}/**/*.{ts,tsx,css,mjs,json}",
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;
const loose = import.meta.glob("../../{README,AGENTS,package}.{md,json}", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const all = { ...sources, ...loose };
const relative = (key: string) => key.replace(/^\.\.\/\.\.\//, "");
export const files = Object.keys(all).map(relative).sort();
const loaders = new Map(Object.entries(all).map(([k, v]) => [relative(k), v]));
export const readSample = (path: string) =>
  loaders.get(path)?.() ?? Promise.reject(new Error("gone"));

const now = Date.now();
const minute = 60_000;

export const projects: Project[] = [
  ["relay", "Relay"],
  ["relay-site", "relay-site"],
].map(([id, name], i) => ({
  id,
  name,
  path: `/Users/you/work/${id}`,
  repository: null,
  added: i,
}));

export const chats: ChatSummary[] = (
  [
    ["drafts", "relay", "Drafts lose their pills after a restart", 3],
    ["menubar", "relay", "Menubar icon blurry on external display", 70],
    ["og-image", "relay-site", "OG image for the download page", 240],
  ] as const
).map(([id, projectId, title, ago]) => ({
  id,
  projectId,
  title,
  scope: { kind: "project" },
  created: now - (ago + 30) * minute,
  updated: now - ago * minute,
  branch: "main",
  provider: "claude",
}));

export const messages: ChatMessage[] = [
  {
    id: "ask",
    role: "user",
    body: "After restarting Relay my draft comes back but the skill pills are plain text again. Can you find where that breaks?",
    status: "complete",
    created: now - 5 * minute,
    provider: "claude",
    version: 1,
  },
  {
    id: "answer",
    role: "assistant",
    body:
      "The draft text is saved, but pills only come back for tokens registered beside it in " +
      "`draftChips`. `promptContent` rebuilds them from that list, and the list is written on " +
      "pick, not on paste, so a pasted `/skill:` token never makes it.\n\nWant me to register " +
      "pasted tokens too, or keep pasted text plain on purpose?",
    status: "complete",
    created: now - 5 * minute + 2000,
    ended: now - 4 * minute,
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    version: 1,
  },
];

const change = (path: string, worktree: string, index = " ") => ({
  path,
  index,
  worktree,
  conflict: false,
});
export const workingTree: WorkingTree = {
  head: "5835caee",
  branch: "main",
  revision: "r1",
  changes: [
    change("src/features/composer/prompt-content.ts", "M"),
    change("src/features/composer/useDraftPills.ts", "M"),
    change("src/lib/thread-storage.ts", "M"),
    change("src/features/composer/prompt-text.test.ts", "?", "?"),
  ],
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  pushTarget: null,
  pushUrl: null,
  operation: null,
  lines: { additions: 42, deletions: 9 },
  outgoing: [],
};
