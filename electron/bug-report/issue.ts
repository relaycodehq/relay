import { redacted } from "../../shared/redact-secrets";

/** What made Relay offer the report; the user asking needs no reason. */
export type Occasion =
  | { kind: "asked" }
  | { kind: "quit"; at: number; dump: boolean }
  | { kind: "window"; reason: string; exitCode: number };

export interface IssueInput {
  repo: string;
  occasion: Occasion;
  /** "Relay 0.6.0 · macOS 15.6 arm64 · Electron 44.4.2" */
  about: string;
  /** main.old.log and main.log, oldest first. */
  log: string;
}

/**
 * Measured 2026-10: GitHub answers 500 to a new-issue link past about 7 KB,
 * and sending someone signed out to log in drops the link past about 5.5 KB,
 * as it rides along encoded a second time. The log is cut from the front
 * until the whole link fits.
 */
export const urlBudget = 4500;
const entryStart = /^\d{4}-\d\d-\d\dT/;

export function issueUrl({ repo, occasion, about, log }: IssueInput) {
  const base = `https://github.com/${repo}/issues/new`;
  const title = titleFor(occasion);
  const url = (body: string) =>
    `${base}?${new URLSearchParams(title ? { title, body } : { body })}`;
  const lines = redacted(log).trimEnd().split("\n").filter(Boolean);
  let take = lines.length;
  const fits = (n: number) =>
    url(body(occasion, about, tail(lines, n))).length <= urlBudget;
  // Each line costs about the same, so a binary search finds the most that fit.
  if (!fits(take)) {
    let lo = 0;
    while (lo < take) {
      const mid = Math.ceil((lo + take) / 2);
      if (fits(mid)) lo = mid;
      else take = mid - 1;
    }
  }
  return url(body(occasion, about, tail(lines, take)));
}

/** The last `n` lines, starting at a whole entry rather than mid-stack. */
function tail(lines: string[], n: number) {
  const kept = lines.slice(lines.length - n);
  const first = kept.findIndex((line) => entryStart.test(line));
  return first > 0 ? kept.slice(first) : kept;
}

function titleFor(occasion: Occasion) {
  if (occasion.kind === "quit") return "Relay quit unexpectedly";
  if (occasion.kind === "window")
    return `Relay's window crashed (${occasion.reason})`;
  return "";
}

function body(occasion: Occasion, about: string, log: string[]) {
  const what = whatHappened(occasion);
  const text = log.join("\n");
  // A fence longer than any run of backticks in the log can't be closed by it.
  const fence = "`".repeat(
    Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return [
    "<!-- What were you doing, and what did you expect to happen? -->",
    "",
    "",
    "---",
    about,
    ...(what ? [what] : []),
    "",
    log.length
      ? [
          "<details><summary>Log, with secrets removed. Delete anything you'd rather not share.</summary>",
          "",
          fence,
          text,
          fence,
          "</details>",
        ].join("\n")
      : "No log yet.",
  ].join("\n");
}

function whatHappened(occasion: Occasion) {
  if (occasion.kind === "quit")
    return `Last run, started ${new Date(occasion.at).toISOString()}, quit unexpectedly${occasion.dump ? " and left a crash dump" : ""}.`;
  if (occasion.kind === "window")
    return `The window's process ended: ${occasion.reason}, exit code ${occasion.exitCode}.`;
  return "";
}
