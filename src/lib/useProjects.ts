import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bootstrap } from "../../shared/types";
import { api } from "./api";
import { sweepThreadStorage } from "./thread-storage-sweep";

/** The projects, kept fresh; once they're in, a sweep of what deleted threads left in storage. */
export function useProjects(boot: Bootstrap | undefined) {
  const projects = useQuery({
    queryKey: ["projects", boot?.account?.id],
    queryFn: () => api.projects(),
    refetchInterval: 5000,
    enabled: !!boot,
  });
  // Off the startup path; it asks for every thread list itself.
  useEffect(() => {
    if (!projects.data) return;
    const sweep = setTimeout(
      () => void sweepThreadStorage(api).catch(() => {}),
      3000,
    );
    return () => clearTimeout(sweep);
  }, [!!projects.data]);
  return projects;
}
