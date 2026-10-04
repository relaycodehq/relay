import type { WatchScope } from "../../../shared/watch";
import { api } from "../../lib/api";
import { Segmented } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { useSavedSetting } from "./useSavedSetting";

/**
 * Off, the main thread, or with its subagents, and roughly what a check
 * costs, as measured on real Claude Code runs.
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
            ["main", "Main thread"],
            ["subagents", "With subagents"],
          ]}
          onChange={(scope) => {
            if (!watch.saving) watch.set(scope);
          }}
        />
      </div>
      {watch.error && <ErrorBox error={watch.error} />}
      <p className="watch-cost">
        Checks every 6 tool calls and when a subagent ends · about 2–4¢ a check
        on Opus 5.5
      </p>
    </>
  );
}
