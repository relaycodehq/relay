import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  defaultAutoCompact,
  type AutoCompact,
} from "../../../../shared/context-usage";
import { api } from "../../../lib/api";
import {
  autoCompactQuery,
  useAutoCompactSaved,
} from "../../agents/auto-compact";
import { setTipsShown, useTipsShown } from "../../tips/tip-memory";
import { Switch } from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import { AutoSettleSelect, WorktreeCleanupSelect } from "../AutoSettleSettings";
import { RenderModeSetting } from "../RenderModeSetting";
import type { SettingEntry } from "../settings-search";
import { useSavedSetting } from "../useSavedSetting";

/**
 * Settings → Threads: what Relay does with a thread while it works, waits
 * and goes quiet, in that order.
 */
export function useThreadEntries(): SettingEntry[] {
  const tipsShown = useTipsShown();
  return [
    {
      id: "keep-awake",
      category: "threads",
      section: "While agents work",
      title: "Keep this computer awake",
      description:
        "So agents keep working and a phone can still reach it after you walk away. Plugged in, it never idles to sleep while Relay runs; on battery, only while an agent works or a phone is paired, and not under 20%. The screen still turns off and locks, and closing the lid still sleeps it.",
      keywords:
        "sleep awake caffeinate idle power battery plugged lid screen lock reachable phone",
      render: () => <KeepAwakeSwitch />,
    },
    {
      id: "tips",
      category: "threads",
      section: "While agents work",
      title: "Tips from Clip",
      description:
        "When an agent has been working a while, Clip peeks up at the right of its thinking line with one thing Relay can do that you haven't set up. Right-click him to turn tips off.",
      keywords:
        "tips clip paperclip clippy hints suggestions peek eyes working onboarding",
      render: () => (
        <Switch label="Show tips" checked={tipsShown} onChange={setTipsShown} />
      ),
    },
    {
      id: "render-mode",
      category: "threads",
      section: "Answers",
      title: "Visualizations",
      description:
        "Charts, tables and mockups agents draw in their answers, at a thousand or more tokens each. When asked: only when you ask to see something. Off: never.",
      keywords:
        "visualization visualisation chart diagram table mockup html page show_html preview_html render tokens cost save cheap off",
      block: true,
      render: () => <RenderModeSetting />,
    },
    {
      id: "compact-idle",
      category: "threads",
      section: "While a thread waits",
      title: "Compact before the cache expires",
      description:
        "While a thread waits for you, compact it 5 min before its prompt cache goes cold, so coming back starts on a short summary. Threads over 120k tokens.",
      keywords:
        "compact compaction summary summarize idle cache prompt cold expire automatic auto tokens context window",
      render: () => <AutoCompactSwitch which="idle" />,
    },
    {
      id: "compact-cold",
      category: "threads",
      section: "While a thread waits",
      title: "Send compacts a cold thread first",
      description:
        "When the cache has expired, Send summarizes the thread before your message goes out. The button next to Send does the other thing for one message. Threads over 120k tokens.",
      keywords:
        "compact compaction summary summarize send cache prompt cold expire automatic auto tokens context window",
      render: () => <AutoCompactSwitch which="cold" />,
    },
    {
      id: "auto-settle",
      category: "threads",
      section: "Settling",
      title: "Auto-settle quiet threads",
      description:
        "Move a thread to Settled once it has been quiet this long, or once Relay sees its PR merged. New activity brings it back. Each project can override this through Project settings in its menu, and one thread can opt out from its right-click menu.",
      keywords:
        "settle settled auto automatic inactive quiet days merged pull request activity sidebar done",
      render: () => <AutoSettleSelect />,
    },
    {
      id: "worktree-cleanup",
      category: "threads",
      section: "Settling",
      title: "Remove settled threads' worktrees",
      description:
        "Free the disk a settled thread's worktree takes, once it has been settled this long. Its branch stays, and writing in the thread again checks the branch out in a new worktree. A worktree with uncommitted changes, or with something running in it, stays. Each project can override this through Project settings in its menu.",
      keywords:
        "worktree cleanup clean remove delete disk space settled branch folder prune",
      render: () => <WorktreeCleanupSelect />,
    },
  ];
}

function KeepAwakeSwitch() {
  const keepAwake = useSavedSetting(
    { queryKey: ["keep-awake"], queryFn: () => api.keepAwake() },
    (enabled) => api.saveKeepAwake(enabled),
    ["keep-awake"],
  );
  return (
    <>
      <Switch
        label="Keep this computer awake"
        checked={keepAwake.value ?? true}
        disabled={!keepAwake.loaded || keepAwake.saving}
        onChange={(enabled) => keepAwake.set(enabled)}
      />
      {keepAwake.error && <ErrorBox error={keepAwake.error} />}
    </>
  );
}

function AutoCompactSwitch({ which }: { which: keyof AutoCompact }) {
  const qc = useQueryClient();
  const saved = useAutoCompactSaved();
  const { queryKey } = autoCompactQuery;
  // The two switches save one object: each change goes over what the other
  // just set, shown at once, and only the last answer back is kept.
  const save = useMutation({
    mutationKey: queryKey,
    mutationFn: (value: AutoCompact) => api.saveAutoCompact(value),
    onMutate: (value) => qc.setQueryData(queryKey, value),
    onSuccess: (value) => {
      if (qc.isMutating({ mutationKey: queryKey }) <= 1)
        qc.setQueryData(queryKey, value);
    },
    onError: () => void qc.invalidateQueries({ queryKey }),
  });
  const value = saved ?? defaultAutoCompact;
  return (
    <>
      <Switch
        label={
          which === "idle"
            ? "Compact before the cache expires"
            : "Send compacts a cold thread first"
        }
        checked={value[which]}
        disabled={saved === undefined}
        onChange={(on) =>
          save.mutate({
            ...(qc.getQueryData<AutoCompact>(queryKey) ?? value),
            [which]: on,
          })
        }
      />
      {save.error && <ErrorBox error={save.error} />}
    </>
  );
}
