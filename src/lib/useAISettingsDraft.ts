import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { aiSettingsSchema, type AISettings } from "../../shared/settings";
import type { AgentProvider } from "../../shared/agents";
import { api } from "./api";
import { useAISettings } from "./useAISettings";

export type AISettingsDraft = ReturnType<typeof useAISettingsDraft>;

type Helper =
  "grouping" | "questions" | "split" | "commitMessage" | "timesheet";

/**
 * The AI settings as edited, until saved. They keep their explicit save: a
 * model run is expensive to change by accident.
 */
export function useAISettingsDraft(setError: (error: unknown) => void) {
  const settings = useAISettings(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<AISettings>();
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const values = draft ?? settings.data;
  const edit = (next: AISettings) => {
    setDraft(next);
    setSaved(false);
  };
  return {
    settings,
    values,
    saving,
    saved,
    canSave: !!draft && !saving && aiSettingsSchema.safeParse(values).success,
    /** Sets one helper's model and the agent that runs it. */
    change(
      kind: Helper,
      value: AISettings["questions"],
      provider: AgentProvider,
    ) {
      if (values)
        edit({ ...values, [kind]: value, [`${kind}Provider`]: provider });
    },
    setThreadProvider(threadProvider: AgentProvider) {
      if (values) edit({ ...values, threadProvider });
    },
    async save() {
      setSaving(true);
      setError(undefined);
      try {
        const next = await api.saveAISettings(values!);
        qc.setQueryData(["ai-settings"], next);
        setDraft(undefined);
        setSaved(true);
      } catch (error) {
        setError(error);
      } finally {
        setSaving(false);
      }
    },
  };
}
