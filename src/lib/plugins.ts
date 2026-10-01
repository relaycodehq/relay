import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClockifyStatus } from "../../shared/clockify";
import type { PluginId, PluginToggles } from "../../shared/plugins";
import { api } from "./api";

const usePlugins = () =>
  useQuery({ queryKey: ["plugins"], queryFn: () => api.plugins() });

export function usePluginEnabled(id: PluginId) {
  return !!usePlugins().data?.[id];
}

/** Flips the switch at once and settles on what was saved. */
export function useSetPluginEnabled() {
  const qc = useQueryClient();
  return async (id: PluginId, enabled: boolean) => {
    const before = qc.getQueryData<PluginToggles>(["plugins"]);
    if (before) qc.setQueryData(["plugins"], { ...before, [id]: enabled });
    try {
      qc.setQueryData(["plugins"], await api.setPluginEnabled(id, enabled));
    } catch {
      qc.setQueryData(["plugins"], before);
    }
    // A running day pauses when its plugin is turned off.
    await qc.invalidateQueries({ queryKey: clockifyKey });
    // Azure DevOps keeps its switch in its own settings.
    await qc.invalidateQueries({ queryKey: devopsKey });
  };
}

export const devopsKey = ["devops-status"];
export const devopsConnectionKey = ["devops-connection"];

export const useDevOpsStatus = () =>
  useQuery({ queryKey: devopsKey, queryFn: () => api.devopsStatus() });

/** The organization's work item fields, for sorting and team filters. */
export const useDevOpsFields = (enabled: boolean) =>
  useQuery({
    queryKey: ["devops-fields"],
    queryFn: () => api.devopsFields(),
    enabled,
    staleTime: 60 * 60_000,
    retry: false,
  });

/** Who Azure DevOps signs Relay in as, and where `az` is; once it has an organization. */
export const useDevOpsConnection = (enabled: boolean) =>
  useQuery({
    queryKey: devopsConnectionKey,
    queryFn: () => api.devopsConnection(),
    enabled,
  });

export const clockifyKey = ["clockify-status"];

/** Polls while Luna is writing the descriptions, so they appear when ready. */
export const useClockifyStatus = (enabled = true) =>
  useQuery({
    queryKey: clockifyKey,
    queryFn: () => api.clockifyStatus(),
    enabled,
    refetchInterval: (q) =>
      (q.state.data as ClockifyStatus | undefined)?.review?.describing
        ? 1500
        : false,
  });

/** The Clockify workspaces the saved key can see. */
export const useClockifyWorkspaces = (host: string, enabled: boolean) =>
  useQuery({
    queryKey: ["clockify-workspaces", host],
    queryFn: () => api.clockifyWorkspaces(),
    enabled,
  });

/** Relay projects that can be tracked: every one but the scratch pad. */
export const useTrackableProjects = () =>
  useQuery({
    queryKey: ["clockify-relay-projects"],
    queryFn: async () => (await api.projects()).filter((p) => !p.scratch),
  });

/** The workspace's Clockify projects, for names and colours. */
export const useClockifyProjects = (enabled = true) =>
  useQuery({
    queryKey: ["clockify-projects-list"],
    queryFn: () => api.clockifyProjects(),
    enabled,
    staleTime: 5 * 60_000,
  });

/** A Clockify project's colour, or the accent when it has none. */
export const projectColor = (
  projects: { id: string; color?: string }[] | undefined,
  id: string,
) => projects?.find((p) => p.id === id)?.color ?? "var(--accent)";
