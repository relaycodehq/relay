import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import type { ProjectCheckState } from "../../../shared/checks";
import { api } from "../../lib/api";
import { useWindowFocused } from "../../lib/window-focus";
import { usePoll } from "../../lib/poll";

/** How long Relay sits in the background before the checker quits to free its memory. */
const SLEEP_AFTER_MS = 2 * 60_000;

function useWindowHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/** True once the window has been unfocused or hidden for `SLEEP_AFTER_MS`. */
function useAsleep(away: boolean) {
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (!away) {
      setAsleep(false);
      return;
    }
    const timer = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [away]);
  return asleep;
}

/**
 * `busy` pauses rechecking (e.g. while an agent is editing the tree); so does a
 * hidden window. The language service stays loaded and checks once on resume.
 * After a while in the background it quits instead, and starts cold on return.
 */
export function useProjectChecks(
  pull?: Pull,
  local?: { id: string; head: string },
  busy = false,
) {
  const poll = usePoll();
  const qc = useQueryClient();
  // This window's hold on a checker other windows may share.
  const [holder] = useState(() => crypto.randomUUID());
  const hidden = useWindowHidden(),
    focused = useWindowFocused(),
    asleep = useAsleep(hidden || !focused),
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
    refetchInterval: (q) => poll(q.state.data === null ? 3000 : false),
  });
  const queryKey = useMemo(() => ["project-check-state", identity], [identity]);
  const state = useQuery({
    queryKey,
    queryFn: () =>
      local
        ? api.localCheckState(local.id, local.head)
        : api.projectCheckState(pull!, pull!.head.sha),
    enabled: !!(pull || local),
    refetchInterval: poll(enabled && !asleep ? (paused ? 5000 : 1000) : false),
    retry: false,
  });
  const target =
    info.data?.targets.find((t) => t.id === selection) ?? info.data?.targets[0];
  useEffect(() => {
    if ((!pull && !local) || !target || !enabled || asleep) return;
    let current = true;
    setError(undefined);
    void (
      local
        ? api.startLocalChecks(local.id, local.head, target.id, holder, paused)
        : api.startProjectChecks(
            pull!,
            pull!.head.sha,
            target.id,
            holder,
            paused,
          )
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
        local
          ? api.stopLocalChecks(local.id, holder)
          : api.stopProjectChecks(pull!, holder)
      ).catch(() => {});
      qc.setQueryData(queryKey, null);
    };
  }, [identity, target?.id, enabled, asleep, retry]);
  useEffect(() => {
    if ((!pull && !local) || !enabled || asleep) return;
    void (
      local
        ? api.pauseLocalChecks(local.id, paused, holder)
        : api.pauseProjectChecks(pull!, paused, holder)
    )
      .then(() => qc.invalidateQueries({ queryKey }))
      .catch(() => {});
  }, [identity, enabled, asleep, paused]);
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
    /** Quit to free memory while Relay is in the background. */
    asleep,
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
