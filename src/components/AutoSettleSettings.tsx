import { useSavedSetting } from "../lib/useSavedSetting";
import { api } from "../lib/api";
import { ComposerSelect } from "./ComposerSelect";
import { ErrorBox } from "./ui";

const choices = [
  { value: "off", label: "Never" },
  { value: "1", label: "After 1 day" },
  { value: "3", label: "After 3 days" },
  { value: "7", label: "After a week" },
  { value: "14", label: "After 2 weeks" },
  { value: "30", label: "After 30 days" },
] as const;
type Choice = (typeof choices)[number]["value"];

/** How long a thread stays quiet before it settles by itself; off turns merged-PR settling off too. */
export function AutoSettleSelect() {
  const days = useSavedSetting(
    { queryKey: ["auto-settle-days"], queryFn: () => api.autoSettleDays() },
    (days) => api.saveAutoSettleDays(days),
    ["project-chats"],
  );
  const current = days.value;
  if (current === undefined) return null;
  const value = current === null ? "off" : String(current);
  return (
    <>
      <div className="composer-tools model-field">
        <ComposerSelect<Choice | string>
          label="Auto-settle quiet threads"
          value={value}
          options={[
            ...choices,
            // A value saved some other way still shows as it is.
            ...(choices.some((c) => c.value === value)
              ? []
              : [{ value, label: `After ${value} days` }]),
          ]}
          onChange={(next) => days.set(next === "off" ? null : Number(next))}
        />
      </div>
      {days.error && <ErrorBox error={days.error} />}
    </>
  );
}
