import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenCodeAuthAttempt } from "../../../shared/opencode-auth";
import { api } from "../../lib/api";

/** Owns this dialog's OAuth attempt, polling and cancellation; OpenCode owns the login. */
export function useOpenCodeSignIn(directory?: string) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["opencode-connections", directory],
    queryFn: () => api.openCodeAuthProviders(directory),
    retry: false,
    staleTime: 0,
  });
  const [providerId, setProviderId] = useState("opencode");
  const [methodId, setMethodId] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState<OpenCodeAuthAttempt>();
  const [connected, setConnected] = useState<string>();
  const [polling, setPolling] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const alive = useRef(true);
  const owned = useRef<{ provider: string; attempt: string } | undefined>(
    undefined,
  );
  const provider =
    catalog.data?.find((p) => p.id === providerId) ?? catalog.data?.[0];
  // Prefer a browser account over a service-account key where both exist.
  const method =
    provider?.methods.find((m) => m.id === methodId) ??
    provider?.methods.find((m) => m.type === "oauth" && !m.unavailable) ??
    provider?.methods[0];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = owned.current;
      if (current)
        void api
          .openCodeAuth({ kind: "cancel", directory, ...current })
          .catch(() => {});
    };
  }, [directory]);

  async function finish(name: string) {
    if (!alive.current) return;
    const completed = owned.current;
    setConnected(name);
    setKey("");
    setCode("");
    setAttempt(undefined);
    owned.current = undefined;
    if (completed)
      void api
        .openCodeAuth({ kind: "cancel", directory, ...completed })
        .catch(() => {});
    setBusy(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["agent-models", "opencode"] }),
      qc.invalidateQueries({ queryKey: ["provider-commands"] }),
      qc.invalidateQueries({ queryKey: ["agent-defaults"] }),
      qc.invalidateQueries({ queryKey: ["opencode-connections"] }),
    ]);
  }

  useEffect(() => {
    if (!attempt || !polling || !provider) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Math.min(attempt.expires, Date.now() + 5 * 60_000);
    const check = async () => {
      try {
        if (Date.now() >= deadline)
          throw new Error("This sign-in expired. Cancel it and try again.");
        const reply = await api.openCodeAuth({
          kind: "status",
          provider: provider.id,
          directory,
          attempt: attempt.attemptID,
        });
        if (
          stopped ||
          !alive.current ||
          owned.current?.attempt !== attempt.attemptID
        )
          return;
        if (reply.kind !== "status")
          throw new Error("OpenCode didn't return the sign-in status.");
        if (reply.state.status === "complete") {
          await finish(provider.name);
          return;
        }
        if (reply.state.status === "failed")
          throw new Error(reply.state.message);
        if (reply.state.status === "expired")
          throw new Error("This sign-in expired. Cancel it and try again.");
        timer = setTimeout(() => void check(), 1000);
      } catch (e) {
        if (!stopped && alive.current) {
          setError(e);
          setPolling(false);
        }
      }
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [attempt, polling, pollVersion, provider, directory]);

  async function connect() {
    if (!provider || !method) return;
    setBusy(true);
    setError(undefined);
    const answer = Object.fromEntries(
      method.fields.flatMap((f) => {
        const value = answers[f.key] ?? f.default;
        return value === undefined || value === "" ? [] : [[f.key, value]];
      }),
    );
    try {
      const reply = await api.openCodeAuth(
        method.type === "key"
          ? { kind: "key", provider: provider.id, directory, key, answer }
          : {
              kind: "oauth",
              provider: provider.id,
              directory,
              method: method.id,
              answer,
            },
      );
      if (reply.kind === "attempt") {
        const current = {
          provider: provider.id,
          attempt: reply.attempt.attemptID,
        };
        if (!alive.current) {
          void api
            .openCodeAuth({ kind: "cancel", directory, ...current })
            .catch(() => {});
          return;
        }
        owned.current = current;
        setAttempt(reply.attempt);
        setPolling(reply.attempt.mode === "auto");
        await api.openExternal(reply.attempt.url);
      } else if (reply.kind === "done") await finish(provider.name);
      else throw new Error("OpenCode didn't start the sign-in.");
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function cancelAttempt() {
    const current = owned.current;
    owned.current = undefined;
    setPolling(false);
    setBusy(true);
    setError(undefined);
    try {
      if (current)
        await api.openCodeAuth({ kind: "cancel", directory, ...current });
      owned.current = undefined;
      setAttempt(undefined);
      setCode("");
    } catch (e) {
      owned.current = current;
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function completeCode() {
    if (!attempt || !provider) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.openCodeAuth({
        kind: "complete",
        provider: provider.id,
        directory,
        attempt: attempt.attemptID,
        code,
      });
      await finish(provider.name);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return {
    catalog,
    provider,
    method,
    answers,
    setAnswers,
    key,
    setKey,
    code,
    setCode,
    busy,
    error,
    setError,
    attempt,
    connected,
    polling,
    setPolling,
    setPollVersion,
    setProviderId,
    setMethodId,
    connect,
    cancelAttempt,
    completeCode,
    refreshConnections: async () => {
      await catalog.refetch();
      await qc.invalidateQueries({ queryKey: ["agent-models", "opencode"] });
    },
  };
}
