import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
export const aiSettingsQuery = {
  queryKey: ["ai-settings"],
  queryFn: () => api.aiSettings(),
  staleTime: Infinity,
};
export const useAISettings = () => useQuery(aiSettingsQuery);
