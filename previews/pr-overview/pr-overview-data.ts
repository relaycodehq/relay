// Sample pull requests for the PR overview preview. Nothing here is real.
import type { ChatSummary, Project } from "../../shared/projects";

type Relation = "review" | "assigned" | "mine" | "other";
export type Checks = "passing" | "failing" | "running" | "none";
export type ReviewState = "approved" | "changes" | "waiting" | "commented";

export interface SamplePr {
  repo: string;
  number: number;
  title: string;
  author: string;
  relation: Relation;
  state: "open" | "draft" | "merged" | "closed";
  /** Minutes ago. */
  updated: number;
  opened: number;
  comments: number;
  newComments?: number;
  additions: number;
  deletions: number;
  files: number;
  checks: Checks;
  reviewers: { name: string; state: ReviewState }[];
  progress?: { viewed: number; drafts: number };
  head: string;
  base: string;
  body: string;
  dirs: { path: string; files: number; additions: number; deletions: number }[];
}

export interface SampleRepo {
  repo: string;
  /** The local project, when the repository is checked out on this Mac. */
  project?: Project;
}

const project = (id: string, name: string, owner: string, repo: string) =>
  ({
    id,
    name,
    path: `/Users/you/Projects/${repo}`,
    repository: { server: "https://git.example.dev", owner, name: repo },
    added: 0,
  }) satisfies Project;

export const projects: Project[] = [
  project("relay", "Relay", "relay", "relay"),
  project("licensing", "Licensing", "web", "licensing"),
  project("portal", "Portal", "web", "portal"),
  project("openusage", "OpenUsage", "tools", "openusage"),
  project("dotfiles", "Dotfiles", "you", "dotfiles"),
  project("website", "Website", "relay", "website"),
];

export const repos: SampleRepo[] = [
  { repo: "web/licensing", project: projects[1] },
  { repo: "web/portal", project: projects[2] },
  { repo: "relay/relay", project: projects[0] },
  { repo: "tools/openusage", project: projects[3] },
  { repo: "infra/deploy" },
  { repo: "web/design-system" },
  { repo: "you/dotfiles", project: projects[4] },
  { repo: "relay/website", project: projects[5] },
];

export const repoOf = (name: string) => repos.find((r) => r.repo === name)!;

const hour = 60,
  day = 24 * hour;

const dirs = (...d: [string, number, number, number][]) =>
  d.map(([path, files, additions, deletions]) => ({
    path,
    files,
    additions,
    deletions,
  }));

export const pulls: SamplePr[] = [
  {
    repo: "web/portal",
    number: 231,
    title: "Move invoice export to a background job",
    author: "Anna Kováčová",
    relation: "review",
    state: "open",
    updated: 2 * hour,
    opened: 2 * day,
    comments: 3,
    additions: 412,
    deletions: 96,
    files: 14,
    checks: "passing",
    reviewers: [
      { name: "You", state: "waiting" },
      { name: "Marek Hudec", state: "approved" },
    ],
    head: "invoice-export-jobs",
    base: "main",
    body: "Exports over 5k rows timed out the request. They now run as a queued job and the user gets a download link by email when it's ready. Small exports still stream directly.",
    dirs: dirs(
      ["src/app/invoices", 8, 300, 60],
      ["src/app/jobs", 4, 96, 12],
      ["src/environments", 2, 16, 24],
    ),
  },
  {
    repo: "relay/relay",
    number: 418,
    title: "Phone: reconnect the bridge after sleep",
    author: "Tomáš Beneš",
    relation: "review",
    state: "open",
    updated: 5 * hour,
    opened: 1 * day,
    comments: 1,
    additions: 188,
    deletions: 41,
    files: 7,
    checks: "running",
    reviewers: [{ name: "You", state: "waiting" }],
    progress: { viewed: 3, drafts: 1 },
    head: "phone-reconnect",
    base: "main",
    body: "The phone dropped the encrypted bridge whenever the Mac slept and never came back. It now retries with backoff and resumes the session key instead of pairing again.",
    dirs: dirs(
      ["electron/remote", 3, 120, 22],
      ["mobile/src/bridge", 3, 60, 19],
      ["shared", 1, 8, 0],
    ),
  },
  {
    repo: "web/licensing",
    number: 7,
    title: "Seat limits per site",
    author: "Marek Hudec",
    relation: "review",
    state: "open",
    updated: 1 * day,
    opened: 3 * day,
    comments: 6,
    additions: 940,
    deletions: 310,
    files: 38,
    checks: "failing",
    reviewers: [
      { name: "You", state: "waiting" },
      { name: "Anna Kováčová", state: "commented" },
    ],
    head: "site-seat-limits",
    base: "main",
    body: "Licenses can cap seats per site instead of per license. Adds the limit to the site form, enforces it on assignment and shows usage on the license page.",
    dirs: dirs(
      ["src/app/sites", 14, 420, 130],
      ["src/app/licenses", 12, 300, 120],
      ["src/app/interfaces/api", 6, 140, 40],
      ["src/assets/i18n", 6, 80, 20],
    ),
  },
  {
    repo: "infra/deploy",
    number: 52,
    title: "Pin the runner image and cache node_modules",
    author: "Jana Dvořáková",
    relation: "review",
    state: "open",
    updated: 3 * day,
    opened: 3 * day,
    comments: 0,
    additions: 34,
    deletions: 12,
    files: 3,
    checks: "passing",
    reviewers: [{ name: "You", state: "waiting" }],
    head: "pin-runner",
    base: "main",
    body: "Builds broke twice this month when the runner image moved. Pins it by digest and caches node_modules between jobs, which takes about four minutes off a build.",
    dirs: dirs([".gitea/workflows", 2, 30, 10], ["docker", 1, 4, 2]),
  },
  {
    repo: "web/design-system",
    number: 88,
    title: "Dark tokens for the table component",
    author: "Petra Nováková",
    relation: "assigned",
    state: "open",
    updated: 2 * day,
    opened: 4 * day,
    comments: 2,
    additions: 220,
    deletions: 180,
    files: 11,
    checks: "passing",
    reviewers: [{ name: "Tomáš Beneš", state: "approved" }],
    head: "table-dark-tokens",
    base: "main",
    body: "Replaces the hard-coded greys in the table with tokens so dark mode stops looking like a spreadsheet from 2009.",
    dirs: dirs(["src/table", 7, 160, 150], ["src/tokens", 4, 60, 30]),
  },
  {
    repo: "web/licensing",
    number: 4,
    title: "License search: server-side search and an All Licenses page",
    author: "You",
    relation: "mine",
    state: "open",
    updated: 7,
    opened: 2 * day,
    comments: 11,
    newComments: 2,
    additions: 1840,
    deletions: 620,
    files: 60,
    checks: "passing",
    reviewers: [
      { name: "Marek Hudec", state: "changes" },
      { name: "Anna Kováčová", state: "approved" },
    ],
    head: "license-search",
    base: "main",
    body: "Search moves to the server so it works past the first page. Adds an All Licenses page for system admins, a System section in the nav and a new header.",
    dirs: dirs(
      ["src/app/licenses", 18, 700, 220],
      ["src/app/main", 14, 420, 180],
      ["src/app/guards", 6, 260, 40],
      ["src/app/interfaces", 12, 300, 120],
    ),
  },
  {
    repo: "web/portal",
    number: 226,
    title: "Upgrade Angular and Material to 22",
    author: "You",
    relation: "mine",
    state: "open",
    updated: 1 * day,
    opened: 21 * day,
    comments: 4,
    additions: 2310,
    deletions: 2250,
    files: 140,
    checks: "passing",
    reviewers: [{ name: "Anna Kováčová", state: "approved" }],
    head: "angular-22",
    base: "main",
    body: "Framework bump. Most of the diff is the Material theming migration; the rest is standalone component imports.",
    dirs: dirs(["src/app", 120, 2000, 2100], ["src/styles", 16, 300, 140]),
  },
  {
    repo: "relay/relay",
    number: 421,
    title: "Quick switch between model presets",
    author: "You",
    relation: "mine",
    state: "draft",
    updated: 40,
    opened: 1 * day,
    comments: 0,
    additions: 640,
    deletions: 88,
    files: 16,
    checks: "running",
    reviewers: [],
    head: "quick-switch",
    base: "main",
    body: "⌘⌥←/→ steps through presets in the composer. Draft until the Settings page is done.",
    dirs: dirs(["src/components", 9, 480, 60], ["src/lib", 5, 140, 28]),
  },
  {
    repo: "relay/relay",
    number: 415,
    title: "Share snapshots without Gitea",
    author: "Tomáš Beneš",
    relation: "other",
    state: "open",
    updated: 6 * hour,
    opened: 5 * day,
    comments: 9,
    additions: 1210,
    deletions: 330,
    files: 29,
    checks: "passing",
    reviewers: [{ name: "Jana Dvořáková", state: "commented" }],
    head: "share-snapshots",
    base: "main",
    body: "Uploads a redacted snapshot of a thread instead of pushing a branch to Gitea.",
    dirs: dirs(["electron", 12, 700, 200], ["src/components", 10, 400, 100]),
  },
  {
    repo: "relay/relay",
    number: 409,
    title: "Bump electron to 39.2",
    author: "renovate",
    relation: "other",
    state: "open",
    updated: 2 * day,
    opened: 6 * day,
    comments: 0,
    additions: 12,
    deletions: 12,
    files: 2,
    checks: "failing",
    reviewers: [],
    head: "renovate/electron",
    base: "main",
    body: "Updates electron from 39.1.4 to 39.2.0.",
    dirs: dirs([".", 2, 12, 12]),
  },
  {
    repo: "tools/openusage",
    number: 63,
    title: "Usage history export to CSV",
    author: "Jana Dvořáková",
    relation: "other",
    state: "open",
    updated: 9 * hour,
    opened: 2 * day,
    comments: 2,
    additions: 260,
    deletions: 30,
    files: 8,
    checks: "passing",
    reviewers: [{ name: "Petra Nováková", state: "approved" }],
    head: "csv-export",
    base: "main",
    body: "Adds Export… to the history window.",
    dirs: dirs(["src/history", 6, 240, 20], ["src/menu", 2, 20, 10]),
  },
  {
    repo: "tools/openusage",
    number: 61,
    title: "Fix tray icon on Linux",
    author: "Petra Nováková",
    relation: "other",
    state: "open",
    updated: 4 * day,
    opened: 8 * day,
    comments: 5,
    additions: 44,
    deletions: 18,
    files: 3,
    checks: "passing",
    reviewers: [{ name: "Jana Dvořáková", state: "changes" }],
    head: "linux-tray",
    base: "main",
    body: "The tray icon rendered as a black square on GNOME.",
    dirs: dirs(["src/tray", 3, 44, 18]),
  },
  {
    repo: "web/portal",
    number: 229,
    title: "Cookie banner copy for DE and AT",
    author: "Eva Horváthová",
    relation: "other",
    state: "open",
    updated: 1 * day,
    opened: 1 * day,
    comments: 1,
    additions: 48,
    deletions: 6,
    files: 4,
    checks: "passing",
    reviewers: [],
    head: "cookie-copy-de",
    base: "main",
    body: "Legal-approved wording for the German-speaking markets.",
    dirs: dirs(["src/assets/i18n", 4, 48, 6]),
  },
  {
    repo: "web/licensing",
    number: 6,
    title: "Audit log for license changes",
    author: "Marek Hudec",
    relation: "other",
    state: "draft",
    updated: 2 * day,
    opened: 6 * day,
    comments: 0,
    additions: 520,
    deletions: 14,
    files: 12,
    checks: "none",
    reviewers: [],
    head: "audit-log",
    base: "main",
    body: "Work in progress: records who changed a license and when.",
    dirs: dirs(["src/app/audit", 9, 480, 0], ["src/app/licenses", 3, 40, 14]),
  },
  {
    repo: "infra/deploy",
    number: 50,
    title: "Staging: separate Redis instance",
    author: "Jana Dvořáková",
    relation: "other",
    state: "open",
    updated: 5 * day,
    opened: 9 * day,
    comments: 3,
    additions: 70,
    deletions: 20,
    files: 4,
    checks: "passing",
    reviewers: [{ name: "Tomáš Beneš", state: "approved" }],
    head: "staging-redis",
    base: "main",
    body: "Staging stops sharing Redis with preview environments.",
    dirs: dirs(["k8s/staging", 4, 70, 20]),
  },
  {
    repo: "relay/relay",
    number: 412,
    title: "Deep review with a council of agents",
    author: "You",
    relation: "mine",
    state: "merged",
    updated: 1 * day,
    opened: 7 * day,
    comments: 14,
    additions: 2100,
    deletions: 400,
    files: 44,
    checks: "passing",
    reviewers: [{ name: "Tomáš Beneš", state: "approved" }],
    head: "deep-review",
    base: "main",
    body: "Several agents review a diff in parallel and one merges their findings.",
    dirs: dirs(["electron", 20, 1200, 200], ["src/components", 24, 900, 200]),
  },
  {
    repo: "web/portal",
    number: 224,
    title: "Remove the legacy PDF renderer",
    author: "Anna Kováčová",
    relation: "other",
    state: "merged",
    updated: 2 * day,
    opened: 10 * day,
    comments: 2,
    additions: 20,
    deletions: 1400,
    files: 22,
    checks: "passing",
    reviewers: [{ name: "You", state: "approved" }],
    head: "drop-legacy-pdf",
    base: "main",
    body: "The new renderer has been default for a month.",
    dirs: dirs(["src/app/pdf", 22, 20, 1400]),
  },
  {
    repo: "tools/openusage",
    number: 59,
    title: "Try Tauri 3 alpha",
    author: "Petra Nováková",
    relation: "other",
    state: "closed",
    updated: 6 * day,
    opened: 12 * day,
    comments: 3,
    additions: 300,
    deletions: 280,
    files: 18,
    checks: "failing",
    reviewers: [],
    head: "tauri-3",
    base: "main",
    body: "Too early.",
    dirs: dirs(["src-tauri", 18, 300, 280]),
  },
];

export const keyOf = (p: SamplePr) => `${p.repo}#${p.number}`;
export const isOpen = (p: SamplePr) => p.state === "open" || p.state === "draft";

export const ago = (minutes: number) =>
  minutes < 60
    ? `${minutes}m`
    : minutes < 24 * 60
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / (24 * 60))}d`;

export const initials = (name: string) =>
  name === "You"
    ? "YO"
    : name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

/** One line on where a PR stands, from the reader's side. */
export function standing(p: SamplePr): string {
  if (p.state === "merged") return "Merged";
  if (p.state === "closed") return "Closed";
  if (p.state === "draft") return "Draft";
  const changes = p.reviewers.find((r) => r.state === "changes");
  if (p.relation === "mine") {
    if (changes) return `Changes requested by ${first(changes.name)}`;
    if (p.checks === "failing") return "Checks failing";
    const approved = p.reviewers.find((r) => r.state === "approved");
    if (approved) return `Approved by ${first(approved.name)} · ready to merge`;
    return "Waiting for review";
  }
  if (p.relation === "review")
    return p.progress
      ? `You've viewed ${p.progress.viewed} of ${p.files} files`
      : `${first(p.author)} asked for your review`;
  if (p.relation === "assigned") return `Assigned to you by ${first(p.author)}`;
  if (changes) return `Changes requested by ${first(changes.name)}`;
  if (p.reviewers.some((r) => r.state === "approved")) return "Approved";
  return "Waiting for review";
}
const first = (name: string) => name.split(" ")[0];

const minute = 60_000;
const now = Date.now();
const chat = (c: Partial<ChatSummary> & Pick<ChatSummary, "id" | "title">) =>
  ({
    projectId: "relay",
    scope: { kind: "project" },
    created: now - 30 * minute,
    updated: now - minute,
    branch: "main",
    ...c,
  }) as ChatSummary;

/** Sidebar threads; the PR ones are what opening a PR lands on. */
export const chats: ChatSummary[] = [
  chat({
    id: "t-license-pr",
    projectId: "licensing",
    title: "Review #4 · License search",
    scope: { kind: "pr", ref: { owner: "web", name: "licensing", number: 4 } },
    branch: "license-search",
    updated: now - 7 * minute,
  }),
  chat({
    id: "t-license-guard",
    projectId: "licensing",
    title: "Why does the site guard redirect twice?",
    updated: now - 3 * 60 * minute,
  }),
  chat({
    id: "t-relay-phone",
    projectId: "relay",
    title: "Review #418 · Phone reconnect",
    scope: { kind: "pr", ref: { owner: "relay", name: "relay", number: 418 } },
    branch: "phone-reconnect",
    updated: now - 5 * 60 * minute,
  }),
  chat({
    id: "t-relay-shortcuts",
    projectId: "relay",
    title: "Let every shortcut be rebound",
    updated: now - 26 * 60 * minute,
  }),
  chat({
    id: "t-portal",
    projectId: "portal",
    title: "Material 22 theming leftovers",
    updated: now - 30 * 60 * minute,
  }),
];

/** The PR thread a pull already has, if any. */
export const threadFor = (p: SamplePr) =>
  chats.find(
    (c) =>
      c.scope.kind === "pr" &&
      `${c.scope.ref.owner}/${c.scope.ref.name}` === p.repo &&
      c.scope.ref.number === p.number,
  );
