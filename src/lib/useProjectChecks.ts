import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../shared/types";
import type { ProjectCheckState } from "../../shared/checks";
import { api } from "./api";

export function useProjectChecks(pull?: Pull) {
  const qc = useQueryClient();
  const identity = pull ? `${pull.html_url}:${pull.head.sha}` : "";
  const preference = pull ? `relay-checks:${pull.html_url}` : "";
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const { selection, enabled } = useMemo(
    () => ({
      selection: localStorage.getItem(preference + ":target") ?? "",
      enabled: localStorage.getItem(preference) !== "off",
    }),
    [preference, preferenceVersion],
  );
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  useEffect(() => setError(undefined), [preference]);
  const info = useQuery({
    queryKey: ["project-check-info", identity],
    queryFn: () => api.projectCheckInfo(pull!),
    enabled: !!pull,
    retry: false,
    refetchInterval: (q) => (q.state.data === null ? 3000 : false),
  });
  const queryKey = useMemo(() => ["project-check-state", identity], [identity]);
  const state = useQuery({
    queryKey,
    queryFn: () => api.projectCheckState(pull!, pull!.head.sha),
    enabled: !!pull,
    refetchInterval: enabled ? 1000 : false,
    retry: false,
  });
  const target =
    info.data?.targets.find((t) => t.id === selection) ?? info.data?.targets[0];
  useEffect(() => {
    if (!pull || !target || !enabled) return;
    let current = true;
    setError(undefined);
    void api
      .startProjectChecks(pull, pull.head.sha, target.id)
      .then((s) => {
        if (current) qc.setQueryData(queryKey, s);
      })
      .catch((e) => {
        if (current) setError(e);
      });
    return () => {
      current = false;
      void api.stopProjectChecks(pull).catch(() => {});
      qc.setQueryData(queryKey, null);
    };
  }, [identity, target?.id, enabled, retry]);
  const toggle = (value: boolean) => {
    localStorage.setItem(preference, value ? "on" : "off");
    setPreferenceVersion((n) => n + 1);
  };
  const choose = (value: string) => {
    localStorage.setItem(preference + ":target", value);
    setPreferenceVersion((n) => n + 1);
  };
  const buffer = useCallback(
    (path: string, text: string | null) => {
      if (!pull || !enabled) return Promise.resolve();
      qc.setQueryData<ProjectCheckState | null>(queryKey, (s) =>
        s ? { ...s, status: "checking", files: {}, diagnostics: [] } : s,
      );
      return api.updateCheckBuffer(pull, pull.head.sha, path, text);
    },
    [identity, enabled, queryKey],
  );
  return {
    info: info.data,
    state: state.data,
    enabled,
    error: error ?? info.error ?? state.error,
    toggle,
    choose,
    target,
    buffer,
    restart: () => setRetry((n) => n + 1),
    refresh: () => info.refetch(),
  };
}
export type ChecksController = ReturnType<typeof useProjectChecks>;
