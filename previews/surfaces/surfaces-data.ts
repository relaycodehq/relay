// Sample data for the surfaces preview: the thread the chat shows, the
// sidebar's threads, and what the other surfaces hold.
import type { ChatSummary, Project } from "../../shared/projects";
import { sampleThreads } from "../unread-divider/unread-divider-data";

const minute = 60_000;
const now = Date.now();

export const projects: Project[] = [
  { id: "relay", name: "relay", path: "/Users/you/code/relay", repository: null, added: 0 },
  { id: "openusage", name: "openusage", path: "/Users/you/code/openusage", repository: null, added: 1 },
];

const chat = (c: Partial<ChatSummary> & Pick<ChatSummary, "id" | "title">) =>
  ({
    projectId: "relay",
    scope: { kind: "project" },
    created: now - 90 * minute,
    updated: now - 10 * minute,
    branch: "main",
    provider: "claude",
    ...c,
  }) as ChatSummary;

export const openChat = sampleThreads[0]!;
export const messages = openChat.messages;

export const chats: ChatSummary[] = [
  chat({
    id: openChat.id,
    title: openChat.title,
    branch: "relay/fix-flaky-worktrees-spec",
    worktree: {
      path: "/Users/you/code/relay/.worktrees/fix-flaky-worktrees-spec",
      branch: "relay/fix-flaky-worktrees-spec",
    },
    updated: now - 10 * minute,
  }),
  chat({
    id: "pills",
    title: "Inline image pills in the prompt",
    branch: "relay/inline-image-pills",
    running: true,
    runningSince: now - 95_000,
    runningAgents: ["claude"],
    updated: Date.now(),
  }),
  chat({
    id: "outbox",
    title: "Phone outbox retries",
    updated: now - 170 * minute,
    provider: "codex",
  }),
  chat({
    id: "tauri",
    projectId: "openusage",
    title: "Bump the Tauri updater and re-sign",
    branch: "export",
    updated: now - 26 * 60 * minute,
  }),
];

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}
export const changedFiles: ChangedFile[] = [
  { path: "electron/git/worktrees.ts", additions: 14, deletions: 5 },
  { path: "electron/project-chats/handback.ts", additions: 9, deletions: 4 },
  { path: "tests/e2e/worktrees.spec.ts", additions: 6, deletions: 9 },
];
export const lines = changedFiles.reduce(
  (sum, f) => ({ additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }),
  { additions: 0, deletions: 0 },
);

export const diff: { kind: "ctx" | "add" | "del" | "hunk"; text: string }[] = [
  { kind: "hunk", text: "@@ -118,9 +118,14 @@ export async function addWorktree(root, branch) {" },
  { kind: "ctx", text: "  const path = worktreePath(root, branch);" },
  { kind: "del", text: "  void run(root, [\"worktree\", \"add\", \"-b\", branch, path]);" },
  { kind: "del", text: "  emit(\"worktrees-changed\", root);" },
  { kind: "add", text: "  await run(root, [\"worktree\", \"add\", \"-b\", branch, path]);" },
  { kind: "add", text: "  // The watcher reads .git/worktrees/<name>/HEAD; it must be whole first." },
  { kind: "add", text: "  await waitForHead(root, branch);" },
  { kind: "add", text: "  emit(\"worktrees-changed\", root);" },
  { kind: "ctx", text: "  return path;" },
  { kind: "ctx", text: "}" },
  { kind: "hunk", text: "@@ -140,6 +145,12 @@" },
  { kind: "add", text: "async function waitForHead(root: string, branch: string) {" },
  { kind: "add", text: "  const head = join(root, \".git\", \"worktrees\", basename(branch), \"HEAD\");" },
  { kind: "add", text: "  for (let i = 0; i < 50; i++) {" },
  { kind: "add", text: "    if ((await readFile(head, \"utf8\").catch(() => \"\")).trim()) return;" },
  { kind: "add", text: "    await sleep(20);" },
  { kind: "add", text: "  }" },
  { kind: "add", text: "}" },
];

export const tree: { name: string; depth: number; dir?: boolean; open?: boolean }[] = [
  { name: "electron", depth: 0, dir: true, open: true },
  { name: "git", depth: 1, dir: true, open: true },
  { name: "index.ts", depth: 2 },
  { name: "watch.ts", depth: 2 },
  { name: "worktrees.ts", depth: 2 },
  { name: "project-chats", depth: 1, dir: true },
  { name: "main.ts", depth: 1 },
  { name: "preload.ts", depth: 1 },
  { name: "shared", depth: 0, dir: true },
  { name: "src", depth: 0, dir: true },
  { name: "tests", depth: 0, dir: true, open: true },
  { name: "e2e", depth: 1, dir: true, open: true },
  { name: "worktrees.spec.ts", depth: 2 },
  { name: "package.json", depth: 0 },
];

export const commits: { sha: string; title: string; when: string; who: string }[] = [
  { sha: "a0e8123", title: "Show the model picker's own limit meters again", when: "2 h", who: "you" },
  { sha: "30c01df", title: "Say on the website that Relay is built in the Czech Republic", when: "4 h", who: "you" },
  { sha: "a8f90d6", title: "Give the website a real link preview and fuller structured data", when: "5 h", who: "you" },
  { sha: "1619ee1", title: "Show the real composer in the website's window", when: "6 h", who: "you" },
  { sha: "e90afe9", title: "Publish releases on relaycodehq/relay itself", when: "yesterday", who: "you" },
  { sha: "d53f740", title: "Phone low-data mode: patches and deflated frames", when: "2 d", who: "you" },
];

export const terminalLines: string[] = [
  "$ npx playwright test tests/e2e/worktrees.spec.ts --repeat-each 20",
  "",
  "Running 20 tests using 4 workers",
  "  ✓  1 [electron] › worktrees.spec.ts:14 › moves a thread to a worktree (4.1s)",
  "  ✓  2 [electron] › worktrees.spec.ts:14 › moves a thread to a worktree (3.9s)",
  "  ✓  3 [electron] › worktrees.spec.ts:14 › moves a thread to a worktree (4.0s)",
  "  …",
  "  20 passed (1.4m)",
  "$ ",
];
