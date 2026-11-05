import { useRef } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  devopsSettingsSchema,
  organizationUrl,
  type DevOpsSecrets,
  type DevOpsSettings,
  type DevOpsStatus,
} from "../../../shared/devops";
import { api } from "../../lib/api";
import { devopsConnectionKey, devopsKey, usePluginEnabled } from "./plugins";
import { usePluginSaved } from "./plugin-ui";

/**
 * Saves a change to the Azure DevOps settings, shown at once. Resolves
 * false when it isn't saved, with the reason passed to `setError`.
 */
export function useSaveDevOps(
  status: UseQueryResult<DevOpsStatus>,
  setError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const saved = usePluginSaved();
  const on = usePluginEnabled("devops");
  const latest = useRef(0);
  const settings = status.data?.settings;

  return async function save(
    patch: Partial<DevOpsSettings>,
    secrets: DevOpsSecrets = {},
  ) {
    // The plugin's switch owns `enabled`; what's cached here may predate it.
    const next = { ...settings!, ...patch, enabled: on };
    setError(undefined);
    try {
      if (next.organization) organizationUrl(next.organization);
    } catch (e) {
      setError(e);
      return false;
    }
    if (!devopsSettingsSchema.safeParse(next).success) return false;
    const seq = ++latest.current;
    // Show the change at once; an older save landing late mustn't undo a newer one.
    qc.setQueryData<DevOpsStatus>(
      devopsKey,
      (s) => s && { ...s, settings: next },
    );
    try {
      const result = await api.saveDevOpsSettings(next, secrets);
      if (seq === latest.current) qc.setQueryData(devopsKey, result);
      saved();
      void qc.invalidateQueries({ queryKey: ["devops-items"] });
      void qc.invalidateQueries({ queryKey: devopsConnectionKey });
      // Fields asked for before the save landed are the old organization's.
      if ("organization" in patch || "project" in patch)
        void qc.invalidateQueries({ queryKey: ["devops-fields"] });
      // The organization is one the Pull requests page asks.
      void qc.invalidateQueries({ queryKey: ["pull-servers"] });
      return true;
    } catch (e) {
      setError(e);
      void status.refetch();
      return false;
    }
  };
}
