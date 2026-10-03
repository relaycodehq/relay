// The Changes pane's "Split into commits…" on sample data: the plan comes back
// after a moment, commits are made in memory. Open
// http://127.0.0.1:5177/previews/commit-split/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/app/projects.css";
import { initAppearance } from "../../src/lib/appearance";
import { LocalChanges } from "../../src/features/changes/LocalChanges";
import { defaultAISettings } from "../../shared/settings";
import type { CommitSplitPlan } from "../../shared/commit-split";
import type { WorkingTree } from "../../shared/working-tree";

initAppearance();

const files = [
  "src/components/CiStatus.tsx",
  "src/components/ProjectShell.tsx",
  "src/components/projects.css",
  ".relay-probe.mjs",
];
let committed = false;
const tree = (): WorkingTree => ({
  head: "4edf04d",
  branch: "main",
  revision: String(committed),
  changes: committed
    ? [{ path: ".relay-probe.mjs", index: "?", worktree: "?", conflict: false }]
    : files.map((path) =>
        path.startsWith(".")
          ? { path, index: "?", worktree: "?", conflict: false }
          : { path, index: " ", worktree: "M", conflict: false },
      ),
  upstream: "origin/main",
  ahead: committed ? 3 : 0,
  behind: 0,
  pushTarget: "origin/main",
  pushUrl: "https://example.invalid/sample/relay.git",
  operation: null,
  lines: { additions: 111, deletions: 15 },
  outgoing: [],
});
const plan: CommitSplitPlan = {
  fingerprint: "0".repeat(64),
  plannedBy: "Claude · claude-opus-5-5 · High effort",
  changes: [
    { id: 1, path: files[0], status: "modified", additions: 24, deletions: 6 },
    {
      id: 2,
      path: files[1],
      status: "modified",
      part: "lines 88–104",
      additions: 9,
      deletions: 2,
    },
    {
      id: 3,
      path: files[1],
      status: "modified",
      part: "lines 640–651",
      additions: 3,
      deletions: 3,
    },
    { id: 4, path: files[2], status: "modified", additions: 31, deletions: 4 },
    { id: 5, path: files[3], status: "added", additions: 40, deletions: 0 },
  ],
  commits: [
    {
      message:
        "Name the failing job in the CI status\n\nThe badge only said “failed”, so you had to open the run to see which job broke.",
      changes: [1, 4],
    },
    {
      message: "Keep the thread header's CI badge on the current branch",
      changes: [2],
    },
    { message: "Rename the checks toggle to Checks", changes: [3] },
    { message: "", changes: [5], unplaced: true },
  ],
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
Object.assign(window.relay, {
  aiSettings: async () => ({
    ...defaultAISettings,
    split: { model: "claude-opus-5-5", fast: false, reasoningEffort: "high" },
    splitProvider: "claude",
  }),
  projectWorkingTree: async () => tree(),
  projectPlanCommitSplit: async () => {
    await wait(2500);
    return plan;
  },
  projectApplyCommitSplit: async () => {
    await wait(900);
    committed = true;
    return tree();
  },
});

const qc = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <p className="muted" style={{ margin: 0, padding: "6px 12px" }}>
        Sample data
      </p>
      <div style={{ height: "calc(100vh - 30px)", display: "flex" }}>
        <LocalChanges projectId="sample" />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
