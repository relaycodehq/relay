import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// Each read starts an agent CLI, and settings files rarely change.
const cached = {
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;
/** What each agent runs in this project where a thread leaves the model or effort on Default. */
export function useAgentDefaults(projectId: string) {
  const claude = useQuery({
    queryKey: ["claude-defaults", projectId],
    queryFn: () => api.claudeDefaults(projectId),
    ...cached,
  });
  const codex = useQuery({
    queryKey: ["codex-defaults", projectId],
    queryFn: () => api.codexDefaults(projectId),
    ...cached,
  });
  return {
    claude: claude.data ?? undefined,
    codex: codex.data,
    /** Asks again, e.g. as the model picker opens after a settings edit. */
    refresh: () => {
      void claude.refetch();
      void codex.refetch();
    },
  };
}
