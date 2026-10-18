// The stand-in desktop's Git (live-desktop.ts --seed): a checkout with staged
// and unstaged changes, branches, a long history, CI runs and a thread's
// worktree to merge, answered in the shapes electron/git and electron/remote
// give the phone (shared/working-tree.ts, branches.ts, history.ts,
// branch-merge.ts, ci.ts, projects/worktrees.ts). State lives in memory.

type Change = { path: string; previousPath?: string; index: string; worktree: string; conflict: boolean };
type Commit = { sha: string; subject: string };
type Repo = {
  branch: string;
  head: string;
  revision: number;
  changes: Change[];
  upstream: string | null;
  ahead: number;
  behind: number;
  pushTarget: string | null;
  pushUrl: string | null;
  operation: string | null;
  outgoing: Commit[];
};

const hex = (seed: string) => {
  let h = 2166136261;
  let out = "";
  while (out.length < 40) {
    for (const c of seed + out.length) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
};

const subjects = [
  "Pause endless loops while the window is unfocused",
  "Step the live shine at 20 updates a second",
  "Port the bridge's route racing to Swift",
  "Keep the thread pinned while the composer folds",
  "Show CI on the thread header",
  "Merge a worktree's branch without leaving it",
  "Write commit messages for staged files only",
  "Fix the flaky handoff test",
  "Reserve height for live tool rows",
  "Read gitignored files agents wrote into Changes",
  "Group the Git screens by feature",
  "Ask before pushing, never force",
  "Remember the diff layout per device",
  "Name worktree folders after the thread title",
  "Retry a rejected cached credential once",
  "Drop the Expo app",
  "Tunnel the phone to the computer's localhost",
  "Count tokens per second on hover",
  "Sync drafts between phone and desktop",
  "Release v0.16.2",
];
const authors = ["Lubomir Molin", "Claude", "Codex"];

export function gitStandIn(opts: {
  now: number;
  relay: string;
  site: string;
  /** A thread's worktree: its id, branch and the branch it came from. */
  worktree?: { chatId: string; branch: string; from: string };
}) {
  const { now, relay, site } = opts;
  const min = 60_000;
  const history = Array.from({ length: 140 }, (_, i) => ({
    sha: hex(`c${i}`),
    parents: [hex(`c${i + 1}`)],
    author: authors[i % 3],
    time: Math.round((now - (i * 190 + 25) * min) / 1000),
    refs: i === 0 ? [{ name: "main", kind: "head" }] : i === 1 ? [{ name: "origin/main", kind: "remote" }] : i === 12 ? [{ name: "v0.16.2", kind: "tag" }] : [],
    subject: subjects[i % subjects.length],
  }));
  const repo = (branch: string, changes: Change[], extra: Partial<Repo> = {}): Repo => ({
    branch,
    head: history[0].sha,
    revision: 1,
    changes,
    upstream: `origin/${branch}`,
    ahead: 1,
    behind: 2,
    pushTarget: `origin/${branch}`,
    pushUrl: "https://[redacted]@github.com/relaycodehq/relay.git",
    operation: null,
    outgoing: [{ sha: history[0].sha, subject: history[0].subject }],
    ...extra,
  });
  const c = (path: string, index: string, worktree: string): Change => ({ path, index, worktree, conflict: false });
  const repos = new Map<string, Repo>([
    [
      relay,
      repo("main", [
        c("src/styles.css", "M", " "),
        c("src/lib/window-focus.ts", "A", " "),
        c("AGENTS.md", "M", "M"),
        c("src/features/sidebar/Spinner.tsx", " ", "M"),
        c("src/features/sidebar/legacy-spinner.css", " ", "D"),
        c("docs/notes/idle-cpu.md", "?", "?"),
      ]),
    ],
    [site, repo("main", [], { ahead: 0, behind: 0, outgoing: [], pushUrl: "git@gitea.example.com:me/site.git" })],
  ]);
  const wt = opts.worktree;
  if (wt)
    repos.set(
      `${relay}/${wt.chatId}`,
      repo(wt.branch, [c("ios/Relay/Features/Changes/DiffView.swift", " ", "M")], { ahead: 3, behind: 0, outgoing: [] }),
    );
  let landed: { by: string } | null = null;
  /** Staged files that were untracked, which unstaging makes untracked again. */
  const untracked = new Set<string>();

  const repoOf = (where: string) => {
    const r = repos.get(where) ?? (where.startsWith(relay) ? repos.get(relay) : undefined);
    if (!r) throw new Error("Not a Git repository.");
    return r;
  };
  const tree = (r: Repo) => {
    const counts = r.changes.reduce((n, ch) => n + (ch.index === "D" || ch.worktree === "D" ? 0 : 7), 0);
    return {
      head: r.head,
      branch: r.branch,
      revision: `rev-${r.revision}`,
      changes: r.changes.map((ch) => ({ ...ch })),
      upstream: r.upstream,
      ahead: r.ahead,
      behind: r.behind,
      pushTarget: r.pushTarget,
      pushUrl: r.pushUrl,
      operation: r.operation,
      lines: { additions: counts, deletions: Math.round(counts / 3) },
      outgoing: r.outgoing.map((o) => ({ ...o })),
    };
  };
  const checked = (r: Repo, revision: string) => {
    if (revision !== `rev-${r.revision}`) throw new Error("Your checkout changed. Look again and retry.");
    r.revision++;
  };

  function act(where: string, action: any) {
    const r = repoOf(where);
    const picked = (p: string) => (action.paths as string[]).includes(p);
    switch (action.kind) {
      case "stage":
        checked(r, action.revision);
        for (const ch of r.changes.filter((x) => picked(x.path))) {
          if (ch.worktree === "?") untracked.add(ch.path);
          ch.index = ch.worktree === "?" ? "A" : ch.worktree === " " ? ch.index : ch.worktree;
          ch.worktree = " ";
        }
        break;
      case "unstage":
        checked(r, action.revision);
        for (const ch of r.changes.filter((x) => picked(x.path))) {
          if (ch.index === "A" && untracked.has(ch.path)) Object.assign(ch, { index: "?", worktree: "?" });
          else {
            if (ch.worktree === " ") ch.worktree = ch.index;
            ch.index = " ";
          }
        }
        break;
      case "commit": {
        checked(r, action.revision);
        const files: string[] = action.paths ?? r.changes.filter((x) => x.index !== " " && x.index !== "?").map((x) => x.path);
        if (!files.length) throw new Error("Nothing staged to commit.");
        // Committing the index leaves what's only on disk; committing paths takes them as they are on disk.
        r.changes = r.changes
          .map((x) => (files.includes(x.path) && !action.paths && x.worktree !== " " ? { ...x, index: " " } : x))
          .filter((x) => !files.includes(x.path) || (!action.paths && x.index === " "));
        const sha = hex(`new${r.revision}${action.message}`);
        const subject = String(action.message).split("\n")[0];
        r.head = sha;
        history.unshift({ sha, parents: [history[0].sha], author: authors[0], time: Math.round(Date.now() / 1000), refs: [{ name: r.branch, kind: "head" }], subject });
        for (const h of history.slice(1)) h.refs = h.refs.filter((x) => x.kind !== "head");
        r.ahead++;
        r.outgoing.unshift({ sha, subject });
        break;
      }
      case "push":
        checked(r, action.revision);
        if (!r.pushTarget) throw new Error("No remote to push to.");
        r.upstream = r.pushTarget;
        r.ahead = 0;
        r.outgoing = [];
        break;
      case "pull":
        checked(r, action.revision);
        r.behind = 0;
        break;
      case "fetch":
        break;
      default:
        throw new Error(`The stand-in can't ${action.kind}.`);
    }
    return tree(r);
  }

  const lines = (path: string, n = 30) => Array.from({ length: n }, (_, i) => `${i % 5 === 0 ? "// " : "  "}line ${i + 1} of ${path}`);
  const pair = (path: string, kind: "add" | "del" | "mod") => {
    const before = lines(path);
    const after = [...before];
    after.splice(4, 2, "  animation: spin 1s steps(20) infinite;", "  // Stepped at 20 updates a second, paused while the window is unfocused.");
    after.splice(20, 0, "  :root[data-inactive] & { animation-play-state: paused; }");
    const file = (l: string[]) => ({ name: path, contents: l.join("\n") + "\n", cacheKey: path + l.length });
    return {
      old: kind === "add" ? null : file(before),
      next: kind === "del" ? null : file(after),
      binary: false,
    };
  };
  const workingDiff = (where: string, path: string, area: string) => {
    const ch = repoOf(where).changes.find((x) => x.path === path);
    const code = area === "staged" ? ch?.index : ch?.worktree;
    return pair(path, code === "A" || code === "?" ? "add" : code === "D" ? "del" : "mod");
  };

  const extraBranches: string[] = [];
  const branches = () => {
    const r = repos.get(relay)!;
    const local = ["main", wt?.branch ?? "ios-app", "feature/phone-git", "release/0.17", ...extraBranches];
    return {
      current: r.branch,
      head: r.head,
      branches: [
        ...local.map((name) => ({ name, ref: `refs/heads/${name}`, current: name === r.branch, remote: false, worktree: name === wt?.branch && name !== r.branch, unrelated: false })),
        ...["main", wt?.branch ?? "ios-app", "feature/phone-git"].map((name) => ({ name: `origin/${name}`, ref: `refs/remotes/origin/${name}`, current: false, remote: true, worktree: false, unrelated: false })),
      ],
      bases: ["main"],
    };
  };
  function changeBranch(projectId: string, action: any) {
    const r = repoOf(projectId);
    if (action.current !== r.branch || action.head !== r.head) throw new Error("Your checkout changed. Look again and retry.");
    if (action.kind === "create") {
      if (!/^[\w./-]+$/.test(action.name)) throw new Error(`'${action.name}' is not a valid branch name.`);
      extraBranches.push(action.name);
    }
    r.branch = action.name;
    r.upstream = action.kind === "create" ? null : `origin/${action.name}`;
    r.pushTarget = `origin/${action.name}`;
    r.ahead = 0;
    r.behind = 0;
    r.outgoing = [];
    r.revision++;
    return branches();
  }

  const commitDetail = (sha: string) => {
    const i = history.findIndex((h) => h.sha === sha);
    if (i < 0) throw new Error(`No commit ${sha.slice(0, 7)}.`);
    const h = history[i];
    return {
      ...h,
      email: "dev@relaycode.io",
      body: i % 2 ? "" : "The spinner asked for a frame every display refresh. Stepping it and pausing it while the window is\nunfocused takes it from 18% of a core to about 2%.",
      files: [
        { path: "src/styles.css", status: "M", additions: 14, deletions: 3, binary: false },
        { path: "src/lib/window-focus.ts", status: "A", additions: 22, deletions: 0, binary: false },
        { path: "src/features/sidebar/Spinner.tsx", previousPath: "src/ui/Spinner.tsx", status: "R", additions: 5, deletions: 9, binary: false },
        { path: "docs/media/spinner.png", status: "M", additions: 0, deletions: 0, binary: true },
      ],
    };
  };

  const worktreeFiles = [
    { path: "ios/RelayKit/Sources/RelayRemote/Client/RouteRace.swift", additions: 184, deletions: 0 },
    { path: "ios/RelayKit/Sources/RelayRemote/Client/Dial.swift", additions: 96, deletions: 12 },
    { path: "ios/RelayKit/Tests/RelayRemoteTests/PairingRoutesDeltaTests.swift", additions: 61, deletions: 4 },
    { path: "ios/Relay/Features/Changes/DiffView.swift", additions: 9, deletions: 3 },
  ];
  const mergePlan = (where: string, base?: string | null) => {
    if (!wt || where !== `${relay}/${wt.chatId}`) throw new Error("Nothing to merge: this is the default branch.");
    const into = base ?? wt.from;
    return {
      branch: wt.branch,
      head: hex("wt-head"),
      base: into,
      baseHead: hex(`base-${into}`),
      bases: [wt.from, "release/0.17"],
      commits: [
        { sha: hex("wt1"), subject: "Race the routes and keep the fastest" },
        { sha: hex("wt2"), subject: "Dial over LAN before the tailnet" },
        { sha: hex("wt3"), subject: "Test the route order against the TS vectors" },
      ],
      fastForward: into === wt.from,
      pushTarget: `origin/${into}`,
      checkedOutAt: into === wt.from ? "/tmp/relay" : null,
      snapshots: 0,
      uncommitted: 1,
    };
  };
  const merge = (input: any) => {
    // The release branch has moved on under the same files: the stand-in's conflict.
    if (input.base === "release/0.17") return { merged: false, conflicts: ["ios/RelayKit/Sources/RelayRemote/Client/Dial.swift", "ios/Relay/Features/Changes/DiffView.swift"] };
    landed = { by: "merge" };
    return { merged: true, base: input.base, sha: hex("merged"), fastForward: true, pushedTo: input.push ? `origin/${input.base}` : null };
  };

  const ci = (projectId: string, chatId?: string) => {
    if (projectId === site)
      return {
        source: "Gitea",
        branch: "main",
        commit: { sha: history[3].sha, message: "Tidy the footer links", author: "Lubomir Molin" },
        runs: [{ workflow: "Deploy", state: "success", url: "https://gitea.example.com/me/site/actions/runs/88", at: now - 40 * min }],
        ahead: 0,
      };
    if (projectId !== relay) return null;
    const onWorktree = !!wt && chatId === wt.chatId;
    return {
      source: "GitHub",
      branch: onWorktree ? wt!.branch : "main",
      commit: { sha: history[1].sha, message: `${history[1].subject}\n\nMore detail below the fold.`, author: "Claude" },
      runs: [
        { workflow: "Unit tests", state: onWorktree ? "running" : "failure", failedJob: onWorktree ? undefined : "vitest (shard 2/4)", url: "https://github.com/relaycodehq/relay/actions/runs/1", at: now - 12 * min },
        { workflow: "Typecheck", state: "success", url: "https://github.com/relaycodehq/relay/actions/runs/2", at: now - 14 * min },
        { workflow: "E2E", state: "running", url: "https://github.com/relaycodehq/relay/actions/runs/3", at: now - 3 * min },
        { workflow: "Release", state: "skipped", url: "https://github.com/relaycodehq/relay/actions/runs/4", at: now - 14 * min },
      ],
      ahead: 1,
    };
  };

  /** Answers the Git calls, or undefined for every other method. */
  return async (method: string, args: any[]): Promise<unknown> => {
    switch (method) {
      case "projectWorkingTree":
        return tree(repoOf(args[0]));
      case "projectGitAction":
        return act(args[0], args[1]);
      case "projectCommitMessage":
        await new Promise((done) => setTimeout(done, 1200));
        return (args[1] as string[]).some((p) => p.includes("window-focus"))
          ? "Pause endless loops while the window is unfocused\n\nThe spinner repainted at the display's refresh rate behind the editor."
          : "Tidy the sidebar spinner";
      case "projectBranches":
        return branches();
      case "projectChangeBranch":
        return changeBranch(args[0], args[1]);
      case "projectHistory": {
        const limit = Number(args[2]) || 100;
        return { commits: history.slice(0, limit), more: history.length > limit };
      }
      case "projectCommit":
        return commitDetail(args[1]);
      case "projectCommitDiff": {
        const f = commitDetail(args[1]).files.find((x) => x.path === args[2]);
        return f?.binary ? { old: null, next: null, binary: true } : pair(args[2], f?.status === "A" ? "add" : "mod");
      }
      case "projectWorkingDiff":
        return workingDiff(args[0], args[1], args[2]);
      case "projectWorktree":
        if (!wt || args[0] !== wt.chatId) return { files: [], removed: false };
        return { branch: wt.branch, path: `/tmp/relay-worktrees/${wt.branch}`, from: wt.from, files: worktreeFiles, ...(landed ? { landed } : {}), removed: false };
      case "projectWorktreeDiff":
        return pair(args[1], args[1].includes("RouteRace") ? "add" : "mod");
      case "projectMergePlan":
        return mergePlan(args[0], args[1]);
      case "projectMergeBranch":
        return merge(args[1]);
      case "projectCiStatus":
        return ci(args[0], args[1]);
      default:
        return undefined;
    }
  };
}
