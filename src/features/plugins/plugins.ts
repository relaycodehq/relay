import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClockifySettings,
  ClockifyStatus,
} from "../../../shared/clockify";
import type { PluginId, PluginToggles } from "../../../shared/plugins";
import { api } from "../../lib/api";
import { useProjectList } from "../../lib/workspace-queries";
import { usePoll } from "../../lib/poll";

const usePlugins = () =>
  useQuery({ queryKey: ["plugins"], queryFn: () => api.plugins() });

export function usePluginEnabled(id: PluginId) {
  return !!usePlugins().data?.[id];
}

/**
 * Flips the switch at once and settles on what was saved; when saving
 * fails, the switch goes back and the error is thrown on.
 */
export function useSetPluginEnabled() {
  const qc = useQueryClient();
  return async (id: PluginId, enabled: boolean) => {
    const before = qc.getQueryData<PluginToggles>(["plugins"]);
    if (before) qc.setQueryData(["plugins"], { ...before, [id]: enabled });
    try {
      qc.setQueryData(["plugins"], await api.setPluginEnabled(id, enabled));
    } catch (error) {
      qc.setQueryData(["plugins"], before);
      throw error;
    } finally {
      // Asked again meanwhile, so the switch settles without waiting on them.
      void Promise.all([
        // A running day pauses when its plugin is turned off.
        qc.invalidateQueries({ queryKey: clockifyKey }),
        // Azure DevOps keeps its switch in its own settings.
        qc.invalidateQueries({ queryKey: devopsKey }),
        // Its organization is one the Pull requests page asks.
        qc.invalidateQueries({ queryKey: ["pull-servers"] }),
      ]);
    }
  };
}

export const devopsKey = ["devops-status"];
export const devopsConnectionKey = ["devops-connection"];

export const useDevOpsStatus = () =>
  useQuery({ queryKey: devopsKey, queryFn: () => api.devopsStatus() });

/**
 * The work item fields of the saved organization and project, for sorting
 * and team filters; saving another one asks again.
 */
export function useDevOpsFields(enabled: boolean) {
  const settings = useDevOpsStatus().data?.settings;
  return useQuery({
    queryKey: ["devops-fields", settings?.organization, settings?.project],
    queryFn: () => api.devopsFields(),
    enabled: enabled && !!settings,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** Who Azure DevOps signs Relay in as, and where `az` is; once it has an organization. */
export const useDevOpsConnection = (enabled: boolean) =>
  useQuery({
    queryKey: devopsConnectionKey,
    queryFn: () => api.devopsConnection(),
    enabled,
  });

export const clockifyKey = ["clockify-status"];

/** Polls while Luna is writing the descriptions, so they appear when ready. */
export function useClockifyStatus(enabled = true) {
  const poll = usePoll();
  return useQuery({
    queryKey: clockifyKey,
    queryFn: () => api.clockifyStatus(),
    enabled,
    refetchInterval: (q) =>
      poll(
        (q.state.data as ClockifyStatus | undefined)?.review?.describing
          ? 1500
          : false,
      ),
  });
}

/** The Clockify workspaces the saved key can see. */
export const useClockifyWorkspaces = (host: string, enabled: boolean) =>
  useQuery({
    queryKey: ["clockify-workspaces", host],
    queryFn: () => api.clockifyWorkspaces(),
    enabled,
  });

/** Relay projects that can be tracked: every one but the scratch pad. */
export const useTrackableProjects = () =>
  useProjectList((projects) => projects.filter((p) => !p.scratch));

/**
 * The saved workspace's Clockify projects, for names and colours. Keyed by
 * that workspace, so choosing another one in Settings asks again.
 */
export function useClockifyProjects(enabled = true) {
  const status = useClockifyStatus(enabled).data;
  const settings = status?.settings;
  return useQuery({
    queryKey: clockifyProjectsKey(settings),
    queryFn: () => api.clockifyProjects(),
    enabled: enabled && !!status?.hasToken && !!settings?.workspaceId,
    staleTime: 5 * 60_000,
  });
}

export const clockifyProjectsKey = (
  settings: Pick<ClockifySettings, "host" | "workspaceId"> | undefined,
) => ["clockify-projects", settings?.host, settings?.workspaceId];

/** A Clockify project's colour, or the accent when it has none. */
export const projectColor = (
  projects: { id: string; color?: string }[] | undefined,
  id: string,
) => projects?.find((p) => p.id === id)?.color ?? "var(--accent)";
