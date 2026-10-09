import type { WatchScope } from "../../../shared/watch";
import { api } from "../../lib/api";
import { Segmented } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { useSavedSetting } from "./useSavedSetting";
import { WatchReviewDetail } from "./WatchReview";
import { WatchSpendLine } from "./WatchSpend";

/**
 * Off, the main thread, or with its subagents; how a check works, for the
 * programmers deciding; and what the checks spent this past week.
 */
export function WatchThreadsSetting() {
  const watch = useSavedSetting(
    { queryKey: ["watch-threads"], queryFn: () => api.watchThreads() },
    (scope) => api.saveWatchThreads(scope),
    ["watch-threads"],
  );
  if (watch.value === undefined) return null;
  return (
    <>
      <div className="watch-scope">
        <Segmented<WatchScope>
          label="Flag what I'd miss"
          value={watch.value}
          options={[
            ["off", "Off"],
            ["main", "Thread"],
            ["subagents", "+ Subagents"],
          ]}
          onChange={(scope) => {
            if (!watch.saving) watch.set(scope);
          }}
        />
      </div>
      {watch.error && <ErrorBox error={watch.error} />}
      <HowWatchWorks />
      <WatchSpendLine />
      {import.meta.env.DEV && <WatchReviewDetail />}
    </>
  );
}

function HowWatchWorks() {
  return (
    <details className="watch-how">
      <summary>How it works</summary>
      <ul>
        <li>
          One check per turn, after the answer lands, and only when the agent
          made 3 or more tool calls or a subagent changed files.
        </li>
        <li>
          Claude runs it as Claude Code&apos;s <code>/btw</code> on the live
          session; Codex as a throwaway fork of the thread, like{" "}
          <code>/side</code>. Same model, same context, no tools, and nothing is
          written to the thread&apos;s transcript.
        </li>
        <li>
          It reuses the thread&apos;s prompt cache, so a check is mostly cache
          reads, billed to the thread&apos;s account.
        </li>
        <li>
          The bar is high: tests weakened to pass, errors swallowed,
          requirements quietly dropped, tradeoffs made in passing. It skips what
          the answer already says, anything shown before, and topics you closed
          with <i>I know this</i>.
        </li>
        <li>
          <b>+ Subagents</b> (Claude only): their transcripts aren&apos;t in the
          main context, so the check gets a digest of what each one changed and
          compares it with what you asked for.
        </li>
      </ul>
    </details>
  );
}
