// What only a command's output says: how its tests and checks went, and the
// hashes of the commits it made. What `&&` skipped never ran, so it has
// nothing to say.
import type { CallAction } from "./call-actions";
import type { AgentActivity } from "./projects";
import { baseName, type Joiner } from "./shell-words";

type Verdict = Extract<CallAction, { kind: "test" | "check" }>;

const isVerdict = (action: CallAction): action is Verdict => action.kind === "test" || action.kind === "check";

/**
 * A command that failed failed its test or check, when the output didn't say
 * and nothing ran after it: in `npm test && git push`, the push may be what failed.
 */
export function failedByItsCall(actions: CallAction[], a: AgentActivity): CallAction[] {
  if (a.status !== "failed") return actions;
  if (actions.some((action) => isVerdict(action) && action.failed)) return actions;
  const last = actions.at(-1);
  if (!last || !isVerdict(last)) return actions;
  return [...actions.slice(0, -1), { ...last, failed: true }];
}

export type Step = { actions: CallAction[]; joinedBy?: Joiner };

/** After a test or check that failed, whatever `&&` put behind it never started, so it has no verdict to show. */
export function actionsThatRan(steps: Step[]) {
  const ran: CallAction[] = [];
  let lastFailed = false;
  for (const { actions, joinedBy } of steps) {
    const skipped = joinedBy === "&&" && lastFailed;
    if (skipped) continue;
    lastFailed = actions.some((action) => isVerdict(action) && action.failed);
    ran.push(...actions);
  }
  return ran;
}

const failedTests = /\bFAIL\b|Failed Tests|×|\b[1-9]\d* failed/;
const failedChecks = /^tc [1-9]|error TS\d+|^npm (?:ERR!|error)|✖ \d+ problems?|Code style issues found/m;

/** What each kind of check prints when it fails, to tell several checks in one command apart. */
const checkFailures: [name: RegExp, failure: RegExp][] = [
  [/^(?:typecheck|tsc|types)/, /^tc [1-9]|error TS\d+/m],
  [/^lint/, /✖ \d+ problems?/],
  [/^format/, /Code style issues found/],
];

/** What only the output says: a test run's result, a commit's hash. */
export function outcomes(actions: CallAction[], output: string) {
  const severalTests = actions.filter((a) => a.kind === "test").length > 1;
  const severalChecks = actions.filter((a) => a.kind === "check").length > 1;
  const commits = actions.filter((a) => a.kind === "commit");
  const hashes = commitHashes(output, commits.length);
  return (action: CallAction): CallAction => {
    switch (action.kind) {
      case "test":
        return { ...action, failed: testFailed(action.target, output, severalTests) };
      case "check":
        return { ...action, failed: checkFailed(action.name, output, severalChecks) };
      case "commit": {
        const hash = hashes[commits.indexOf(action)];
        return hash ? { ...action, hash } : action;
      }
      default:
        return action;
    }
  };
}

/**
 * Each commit's hash: `git commit` prints "[branch abc1234] subject" for
 * each, "[main (root-commit) abc1234]" for a first one; `git log --oneline`
 * prints "abc1234 subject", which only one commit can be sure is its own.
 */
function commitHashes(output: string, commits: number) {
  const own = [...output.matchAll(/^\[[^\]\n]*\s([0-9a-f]{7,40})\]/gm)].map((found) => found[1]!);
  if (own.length) return own;
  const logged = /^([0-9a-f]{7,40})\s/m.exec(output)?.[1];
  return logged && commits === 1 ? [logged] : [];
}

/**
 * With several checks in one command, each is judged by its own kind of
 * failure, or npm's error naming its script; alone, by any failure.
 */
function checkFailed(name: string, output: string, severalChecks: boolean) {
  if (!severalChecks) return failedChecks.test(output);
  const own = checkFailures.find(([names]) => names.test(name))?.[1];
  const npmNamesIt = output.split("\n").some((line) => /^npm (?:ERR!|error)/.test(line) && line.includes(name));
  return Boolean(own?.test(output)) || npmNamesIt;
}

/** With several test runs in one command, each is judged by the failures that name its file. */
function testFailed(target: string | undefined, output: string, severalTests: boolean) {
  if (!severalTests || !target) return failedTests.test(output);
  const name = baseName(target);
  return output.split("\n").some((line) => failedTests.test(line) && line.includes(name));
}
