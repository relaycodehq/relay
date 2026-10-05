import type { WatchScope } from "../../../shared/watch";
import { api } from "../../lib/api";
import { Segmented } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { useSavedSetting } from "./useSavedSetting";
import { WatchSpendLine } from "./WatchSpend";

/**
 * Off, the main thread, or with its subagents, and what the checks spent
 * this past week.
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
      <WatchSpendLine />
    </>
  );
}
