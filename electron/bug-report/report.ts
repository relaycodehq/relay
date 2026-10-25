import { createHash } from "node:crypto";
import type {
  BugReportDraft,
  BugReportFact,
  BugReportOccasion,
} from "../../shared/bug-report";

/**
 * GitHub refuses an issue body past 65,536 characters; this leaves room for
 * GitHub counting some characters differently than JavaScript does.
 */
export const bodyLimit = 60_000;
const entryStart = /^\d{4}-\d\d-\d\dT/;

export interface SystemInfo {
  version: string;
  packaged: boolean;
  os: string;
  arch: string;
  /** An Intel build running on Apple silicon. */
  translated: boolean;
  electron: string;
  chrome: string;
  node: string;
  memoryGb: number;
  /** Each agent CLI: its name and version, or null when it wasn't found. */
  /**
   * Each agent CLI: its version and the program Relay runs, or null when it
   * wasn't found. `how` is what installed it, `linked` that the user picked it.
   */
  agents: {
    id: string;
    name: string;
    version: string | null;
    path?: string;
    how?: string;
    linked?: boolean;
  }[];
  /** `gh --version`'s number; null without `gh`. */
  gh: string | null;
  /** Where Relay runs from and keeps its data, already anonymized. */
  appPath: string;
  dataPath: string;
}

/** The facts a report offers, each one the user can take out. */
export function systemFacts(
  info: SystemInfo,
  occasion: BugReportOccasion,
): BugReportFact[] {
  const found = info.agents.filter((a) => a.version);
  const missing = info.agents.filter((a) => !a.version);
  const system = (id: string, label: string, value: string): BugReportFact => ({
    id,
    group: "system",
    label,
    value,
  });
  return [
    system(
      "relay",
      "Relay",
      `${info.version}${info.packaged ? "" : " (development build)"}`,
    ),
    system(
      "os",
      "System",
      `${info.os} ${info.arch}${info.translated ? " (Intel build under Rosetta)" : ""}, ${info.memoryGb} GB memory`,
    ),
    system(
      "runtime",
      "Runtime",
      `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    ),
    system("gh", "GitHub CLI", info.gh ? `gh ${info.gh}` : "not installed"),
    system("paths", "Paths", `app ${info.appPath} · data ${info.dataPath}`),
    ...(occasion.kind === "asked"
      ? []
      : [system("occasion", "What Relay saw", occasionText(occasion))]),
    // One row each, so a single agent's path can be left out.
    ...found.map((a): BugReportFact => ({
      id: `agent:${a.id}`.slice(0, 40),
      group: "agents",
      label: a.name,
      value: [
        a.version,
        a.how,
        a.path && `${a.path}${a.linked ? " (picked in Settings)" : ""}`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...(missing.length
      ? [
          {
            id: "agents-missing",
            group: "agents" as const,
            label: "Not found",
            value: missing.map((a) => a.name).join(", "),
          },
        ]
      : []),
  ];
}

export function occasionText(occasion: BugReportOccasion) {
  if (occasion.kind === "quit")
    return `The run started ${new Date(occasion.at).toISOString()} quit unexpectedly${occasion.dump ? " and left a crash dump (kept on this computer, not attached)" : ""}.`;
  if (occasion.kind === "window")
    return `The window's process ended: ${occasion.reason}, exit code ${occasion.exitCode}.`;
  return "";
}

export function defaultTitle(occasion: BugReportOccasion) {
  if (occasion.kind === "quit") return "Relay quit unexpectedly";
  if (occasion.kind === "window")
    return `Relay's window crashed (${occasion.reason})`;
  return "";
}

/** The screenshot's file name in the issue and the saved bundle. */
export const screenshotFile = (i: number) => `screenshot-${i + 1}.png`;
export const recordingName = "performance.zip";
export const perfLogName = "performance-log.txt";

/** Files no route can post: GitHub takes them only dragged into its page. */
export function attachments(draft: BugReportDraft) {
  return [
    ...(draft.recording ? [recordingName] : []),
    ...(draft.attachPerfLog ? [perfLogName] : []),
  ];
}

export interface ReportInput {
  draft: BugReportDraft;
  facts: BugReportFact[];
  /** The whole anonymized log, oldest first. */
  log: string;
  via: "gh" | "api" | "browser";
  /** Leaves the log whole, for the saved bundle. */
  unbounded?: boolean;
}

/** The issue exactly as posted, and how much of the log it holds. */
export function buildReport({
  draft,
  facts,
  log,
  via,
  unbounded,
}: ReportInput) {
  const title =
    draft.title.trim() ||
    defaultTitle(draft.occasion) ||
    (draft.kind === "feature" ? "Feature request" : "Problem report");
  const lines = draft.includeLog
    ? log.trimEnd().split("\n").filter(Boolean)
    : [];
  const shown = facts.filter((f) => !draft.removedFacts.includes(f.id));
  const make = (n: number) =>
    body(
      draft,
      shown,
      draft.includeLog ? tail(lines, n) : null,
      lines.length,
      via,
    );
  let take = lines.length;
  if (!unbounded && make(take).length > bodyLimit) {
    // Lines cost about the same, so a binary search finds the most that fit.
    let lo = 0;
    while (lo < take) {
      const mid = Math.ceil((lo + take) / 2);
      if (make(mid).length <= bodyLimit) lo = mid;
      else take = mid - 1;
    }
    take = lo;
  }
  const kept = tail(lines, take);
  const text = make(take);
  if (text.length > bodyLimit)
    throw new Error(
      "The description is too long for one GitHub issue. Shorten it, or save the report and attach it as a file.",
    );
  return {
    title,
    body: text,
    included: kept.length,
    total: lines.length,
    logText: kept.join("\n"),
  };
}

/** What a send would post; a send is refused unless it matches what was shown. */
export function digestOf(payload: {
  title: string;
  body: string;
  via: string;
  screenshots: string[];
}) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export const reportMarker = (id: string) => `<!-- relay-report:${id} -->`;

/** The last `n` lines, starting at a whole entry rather than mid-stack. */
function tail(lines: string[], n: number) {
  if (n <= 0) return [];
  const kept = lines.slice(lines.length - n);
  const first = kept.findIndex((line) => entryStart.test(line));
  return first > 0 ? kept.slice(first) : kept;
}

function byHand(shots: number, files: string[]) {
  const parts = [
    ...(shots ? [shots === 1 ? "screenshot" : `${shots} screenshots`] : []),
    ...files.map((f) => `\`${f}\``),
  ];
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0];
}

/** Placeholders like `<user>` would vanish as HTML outside code. */
const code = (value: string) => {
  const fence = "`".repeat(longestRun(value) + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value.replaceAll("|", "\\|")}${pad}${fence}`;
};

const longestRun = (text: string) =>
  Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));

const groupTitles: Record<BugReportFact["group"], string> = {
  system: "System information",
  agents: "Agents",
  performance: "Performance",
};

/** Laid out as VS Code's reporter posts: the description, then each part folded. */
function body(
  draft: BugReportDraft,
  facts: BugReportFact[],
  log: string[] | null,
  total: number,
  via: "gh" | "api" | "browser",
) {
  const shots = draft.screenshots.length;
  const files = attachments(draft);
  const logText = log?.join("\n") ?? "";
  const fence = "`".repeat(Math.max(3, longestRun(logText) + 1));
  const version = facts.find((f) => f.id === "relay");
  const os = facts.find((f) => f.id === "os");
  const fold = (summary: string, inside: string[]) => [
    `<details><summary>${summary}</summary>`,
    "",
    ...inside,
    "",
    "</details>",
  ];
  const groups = (["system", "agents", "performance"] as const).flatMap((group) => {
    const rows = facts.filter((f) => f.group === group);
    return rows.length
      ? fold(groupTitles[group], [
          "| | |",
          "|---|---|",
          ...rows.map((f) => `| ${f.label} | ${code(f.value)} |`),
        ])
      : [];
  });
  return [
    reportMarker(draft.id),
    draft.description.trim() || "_Not described._",
    "",
    ...(shots || files.length
      ? [
          via === "browser"
            ? // Only the form shows it: GitHub hides comments once posted.
              `<!-- Drag the ${byHand(shots, files)} from the window Relay opened into this box. -->`
            : [
                ...(via === "gh"
                  ? draft.screenshots.map(
                      (_, i) => `![Screenshot ${i + 1}](./${screenshotFile(i)})`,
                    )
                  : []),
                ...(via === "api" && shots
                  ? [
                      `_${shots === 1 ? "A screenshot follows" : `${shots} screenshots follow`} in a comment: GitHub's API takes text only._`,
                    ]
                  : []),
                ...(files.length
                  ? [
                      `_${files.map((f) => `\`${f}\``).join(" and ")} ${files.length === 1 ? "follows" : "follow"} in a comment: GitHub takes files only dragged into its page._`,
                    ]
                  : []),
              ].join("\n\n"),
          "",
        ]
      : []),
    // Paragraphs, not lines: plain Markdown would run two lines together.
    ...(version ? [`Relay version: ${code(version.value)}`, ""] : []),
    ...(os ? [`OS version: ${code(os.value)}`, ""] : []),
    ...groups,
    ...(log === null
      ? []
      : log.length
        ? fold(
            `Log: ${log.length === total ? `all ${total}` : `newest ${log.length} of ${total}`} lines, anonymized`,
            [fence, logText, fence],
          )
        : []),
    "",
    "<sub>Sent from Relay's problem report. Paths, names and addresses on the sender's computer were replaced with placeholders like `~` and `<project-1>`.</sub>",
  ].join("\n");
}
