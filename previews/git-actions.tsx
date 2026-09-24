// The header's Commit & push split button on sample data: switch the checkout
// state and Gitea to see which action leads; Merge works on the feature branch. Open http://127.0.0.1:5177/previews/git-actions.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/composer-model-picker.css";
import { initAppearance } from "../src/lib/appearance";
import { GitActions } from "../src/components/GitActions";
import type { Project } from "../shared/projects";
import type { WorkingTree } from "../shared/working-tree";
import type { MergePlan } from "../shared/branch-merge";

initAppearance();

const states = {
  changes: { changes: 3, ahead: 0 },
  ahead: { changes: 0, ahead: 2 },
  clean: { changes: 0, ahead: 0 },
  feature: { changes: 0, ahead: 0 },
} as const;
type State = keyof typeof states;
let state: State = "changes";
let branch = "main";
const files = [
  "shared/pasted-texts.ts",
  "tests/e2e/pasted-text.spec.ts",
  "tests/unit/pasted-texts.test.ts",
];
const tree = (): WorkingTree => ({
  head: "7fe6d04",
  branch: state === "feature" ? branch : "main",
  revision: state,
  changes: files
    .slice(0, states[state].changes)
    .map((path) => ({ path, index: " ", worktree: "M", conflict: false })),
  upstream: "origin/main",
  ahead: states[state].ahead,
  behind: 0,
  pushTarget: state === "feature" ? `origin/${branch}` : "origin/main",
  pushUrl: "https://gitea.example/sample/relay.git",
  operation: null,
  lines: { additions: 11, deletions: 11 },
  outgoing: [],
});
const sha = (n: number) => String(n).repeat(40);
const plan = (): MergePlan => {
  if (state !== "feature" || branch === "main")
    throw new Error("main is the main branch");
  return {
    branch,
    head: sha(1),
    base: "main",
    baseHead: sha(2),
    bases: ["main", "develop"],
    commits: [
      { sha: sha(3), subject: "Keep pasted text markers stable across edits" },
      { sha: sha(4), subject: "Cover pasted text in the e2e spec" },
    ],
    fastForward: true,
    pushTarget: "origin/main",
    checkedOutAt: null,
    snapshots: 0,
    uncommitted: 0,
  };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const extra = {
  projectWorkingTree: async () => tree(),
  projectBranchPulls: async () => [],
  projectCommitMessage: async () => {
    await wait(1500);
    return "Keep pasted text markers stable across edits";
  },
  projectGitAction: async () => {
    await wait(700);
    state = "clean";
    return tree();
  },
  projectMergePlan: async () => plan(),
  projectMergeBranch: async () => {
    await wait(700);
    return {
      merged: true,
      base: "main",
      sha: sha(1),
      fastForward: true,
      pushedTo: "origin/main",
    };
  },
  projectBranches: async () => ({
    current: branch,
    head: sha(1),
    branches: [
      {
        name: "main",
        ref: "refs/heads/main",
        current: false,
        remote: false,
        worktree: false,
      },
    ],
  }),
  projectChangeBranch: async () => {
    await wait(400);
    branch = "main";
  },
  projectDeleteBranch: async () => {
    await wait(300);
  },
};
// The stub proxy has no set trap, so this lands on the stub `api` already holds.
Object.assign(window.relay, extra);

const withGitea = {
  id: "sample",
  name: "relay",
  repository: { owner: "sample", name: "relay" },
} as unknown as Project;
const withoutGitea = { ...withGitea, repository: null } as unknown as Project;
const qc = new QueryClient();

function App() {
  const [current, setCurrent] = useState<State>(state);
  const [gitea, setGitea] = useState(true);
  const [error, setError] = useState<unknown>();
  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <p className="muted">
        Sample data. Checkout state:{" "}
        {(Object.keys(states) as State[]).map((s) => (
          <button
            key={s}
            style={{ marginRight: 6 }}
            className={s === current ? "primary" : ""}
            onClick={() => {
              state = s;
              branch = s === "feature" ? "feature/paste" : "main";
              setCurrent(s);
              void qc.invalidateQueries();
            }}
          >
            {s}
          </button>
        ))}
        <label style={{ marginLeft: 12 }}>
          <input
            type="checkbox"
            checked={gitea}
            onChange={(e) => setGitea(e.target.checked)}
          />{" "}
          Gitea repository
        </label>
      </p>
      <div
        className="thread-header-actions"
        style={{
          justifyContent: "flex-end",
          padding: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <GitActions
          key={String(gitea)}
          project={gitea ? withGitea : withoutGitea}
          where="sample"
          connected
          disabled={false}
          request={0}
          onConnect={() => {}}
          onReview={() => {}}
          onChanges={() => {}}
          onError={setError}
        />
      </div>
      {!!error && <p role="alert">{String(error)}</p>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
