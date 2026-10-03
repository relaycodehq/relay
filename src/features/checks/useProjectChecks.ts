import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import type { ProjectCheckState } from "../../../shared/checks";
import { api } from "../../lib/api";

function useWindowHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * `busy` pauses rechecking (e.g. while an agent is editing the tree); so does a
 * hidden window. The language service stays loaded and checks once on resume.
 */
export function useProjectChecks(
  pull?: Pull,
  local?: { id: string; head: string },
  busy = false,
) {
  const qc = useQueryClient();
  const hidden = useWindowHidden(),
    paused = busy || hidden;
  const identity = local
    ? `${local.id}:${local.head}`
    : pull
      ? `${pull.html_url}:${pull.head.sha}`
      : "";
  const preference = local
    ? `relay-checks:project:${local.id}`
    : pull
      ? `relay-checks:${pull.html_url}`
      : "";
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
    queryFn: () =>
      local ? api.localCheckInfo(local.id) : api.projectCheckInfo(pull!),
    enabled: !!(pull || local),
    retry: false,
    refetchInterval: (q) => (q.state.data === null ? 3000 : false),
  });
  const queryKey = useMemo(() => ["project-check-state", identity], [identity]);
  const state = useQuery({
    queryKey,
    queryFn: () =>
      local
        ? api.localCheckState(local.id, local.head)
        : api.projectCheckState(pull!, pull!.head.sha),
    enabled: !!(pull || local),
    refetchInterval: enabled ? (paused ? 5000 : 1000) : false,
    retry: false,
  });
  const target =
    info.data?.targets.find((t) => t.id === selection) ?? info.data?.targets[0];
  useEffect(() => {
    if ((!pull && !local) || !target || !enabled) return;
    let current = true;
    setError(undefined);
    void (
      local
        ? api.startLocalChecks(local.id, local.head, target.id)
        : api.startProjectChecks(pull!, pull!.head.sha, target.id)
    )
      .then((s) => {
        if (current) qc.setQueryData(queryKey, s);
      })
      .catch((e) => {
        if (current) setError(e);
      });
    return () => {
      current = false;
      void (
        local ? api.stopLocalChecks(local.id) : api.stopProjectChecks(pull!)
      ).catch(() => {});
      qc.setQueryData(queryKey, null);
    };
  }, [identity, target?.id, enabled, retry]);
  useEffect(() => {
    if ((!pull && !local) || !enabled) return;
    void (
      local
        ? api.pauseLocalChecks(local.id, paused)
        : api.pauseProjectChecks(pull!, paused)
    )
      .then(() => qc.invalidateQueries({ queryKey }))
      .catch(() => {});
  }, [identity, enabled, paused]);
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
      if ((!pull && !local) || !enabled) return Promise.resolve();
      qc.setQueryData<ProjectCheckState | null>(queryKey, (s) =>
        s ? { ...s, status: "checking", files: {}, diagnostics: [] } : s,
      );
      return local
        ? api.updateLocalCheckBuffer(local.id, local.head, path, text)
        : api.updateCheckBuffer(pull!, pull!.head.sha, path, text);
    },
    [identity, enabled, queryKey],
  );
  return {
    /** Checks a project's workspace rather than a PR's linked folder. */
    local: !!local,
    info: info.data,
    state: state.data,
    enabled,
    paused,
    busy,
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
