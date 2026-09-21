import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
export const useAISettings = () =>
  useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api.aiSettings(),
    staleTime: Infinity,
  });
