// Examples a new schedule can start from: a prompt, when it runs, and where.
// Anything that only reads runs Read only; anything that changes code gets a
// worktree of its own, so a run never trips over what you're working on.
import type { ScheduleInput } from "../../../shared/schedules";

export type ScheduleTemplate = Pick<
  ScheduleInput,
  "name" | "prompt" | "repeat" | "days" | "monthDay" | "time" | "workspace" | "runtimeMode"
> & {
  id: string;
  icon: "bug" | "pull" | "changelog" | "shield" | "tests" | "deps" | "docs";
  /** What it does, for its card. */
  blurb: string;
};

export const scheduleTemplates: ScheduleTemplate[] = [
  {
    id: "critical-bugs",
    icon: "bug",
    name: "Find critical bugs",
    blurb: "Read yesterday's commits for high-severity bugs and fix the ones it can prove.",
    repeat: "weekdays",
    days: [],
    time: "09:00",
    workspace: "worktree",
    runtimeMode: "auto-accept-edits",
    prompt: [
      "Look at the commits from the last day on the main branch.",
      "Hunt for high-severity correctness bugs only: crashes, data loss, wrong results, races. Skip style and nitpicks.",
      "For each bug you can reproduce, fix it with a test that fails before the fix. List the ones you suspect but couldn't prove, with file and line.",
      "If you found nothing, say so in one line.",
    ].join("\n\n"),
  },
  {
    id: "triage-pulls",
    icon: "pull",
    name: "Triage new pull requests",
    blurb: "Each morning, sum up the pull requests opened since yesterday and which need you first.",
    repeat: "weekdays",
    days: [],
    time: "08:30",
    workspace: "checkout",
    runtimeMode: "read-only",
    prompt: [
      "List the pull requests opened or updated since yesterday morning.",
      "For each: one line on what it does, how risky it is, and whether it waits on me.",
      "Put the ones that need me first. Don't comment on or change any of them.",
    ].join("\n\n"),
  },
  {
    id: "changelog",
    icon: "changelog",
    name: "Draft the changelog",
    blurb: "Friday afternoons, turn the week's merged work into release notes people can read.",
    repeat: "weekly",
    days: [4],
    time: "16:00",
    workspace: "checkout",
    runtimeMode: "read-only",
    prompt: [
      "Draft release notes for what landed on the main branch since the last release tag.",
      "Write for the people using it, not the people who wrote it: what's new, what got fixed, what changed. Group small fixes into one line.",
      "Leave out refactors, tests and CI unless someone would notice them.",
    ].join("\n\n"),
  },
  {
    id: "vulnerabilities",
    icon: "shield",
    name: "Scan for vulnerabilities",
    blurb: "Go through the code and its dependencies for security issues worth acting on.",
    repeat: "weekly",
    days: [0],
    time: "10:00",
    workspace: "checkout",
    runtimeMode: "read-only",
    prompt: [
      "Review this repository for security issues: injection, auth gaps, secrets in the code, unsafe deserialization, and dependencies with known advisories.",
      "Report only what you can show is reachable, each with where it is, how it would be exploited and how to fix it. Rank by impact.",
    ].join("\n\n"),
  },
  {
    id: "test-coverage",
    icon: "tests",
    name: "Add test coverage",
    blurb: "Find risky logic changed this week that no test covers, and cover it.",
    repeat: "weekly",
    days: [2],
    time: "11:00",
    workspace: "worktree",
    runtimeMode: "auto-accept-edits",
    prompt: [
      "Look at what changed on the main branch in the last week and find logic that's risky and untested: branching, parsing, money, dates, permissions.",
      "Add tests for the riskiest few, the kind that would catch a real regression. No tests that only restate the code.",
      "Run them, and say what you covered and what you left.",
    ].join("\n\n"),
  },
  {
    id: "dependencies",
    icon: "deps",
    name: "Update dependencies",
    blurb: "Once a month, take the safe updates and list the ones that need a closer look.",
    repeat: "monthly",
    days: [],
    monthDay: 1,
    time: "10:00",
    workspace: "worktree",
    runtimeMode: "auto-accept-edits",
    prompt: [
      "Check which dependencies are out of date.",
      "Take the patch and minor updates, run the build and the tests, and keep only what passes.",
      "List the major updates with what would break, without doing them.",
    ].join("\n\n"),
  },
  {
    id: "docs",
    icon: "docs",
    name: "Keep the docs current",
    blurb: "Update the docs for code that changed this week and doesn't match them anymore.",
    repeat: "weekly",
    days: [0],
    time: "09:00",
    workspace: "worktree",
    runtimeMode: "auto-accept-edits",
    prompt: [
      "Find what changed on the main branch in the last week that the README or docs now describe wrong, or don't describe at all.",
      "Fix those places. Keep the docs' own voice, and don't document what's obvious from the code.",
    ].join("\n\n"),
  },
];
