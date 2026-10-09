import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiSettingsSchema, type AISettings } from "../../../shared/settings";
import { api } from "../../lib/api";
export const aiSettingsQuery = {
  queryKey: ["ai-settings"],
  queryFn: () => api.aiSettings(),
  staleTime: Infinity,
};
export const useAISettings = () => useQuery(aiSettingsQuery);

/**
 * Saves a change to the AI settings as it's made, like the rest of Settings.
 * Each save starts from the newest values, so two quick picks keep both; a
 * failed one reloads what was really saved. Resolves to whether it saved.
 */
export function useSaveAISettings(onError: (error: unknown) => void) {
  const qc = useQueryClient();
  const settings = useAISettings();
  const [savedAt, setSavedAt] = useState<number>();
  const latest = useRef(0);
  async function save(change: Partial<AISettings>) {
    const before = qc.getQueryData<AISettings>(aiSettingsQuery.queryKey);
    if (!before) return false;
    const next = { ...before, ...change };
    if (!aiSettingsSchema.safeParse(next).success) return false;
    const request = ++latest.current;
    qc.setQueryData(aiSettingsQuery.queryKey, next);
    try {
      const saved = await api.saveAISettings(next);
      if (request === latest.current) {
        qc.setQueryData(aiSettingsQuery.queryKey, saved);
        setSavedAt(Date.now());
      }
      return true;
    } catch (error) {
      onError(error);
      await qc.invalidateQueries({ queryKey: aiSettingsQuery.queryKey });
      return false;
    }
  }
  return { settings, values: settings.data, save, savedAt };
}
