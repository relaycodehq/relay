import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { Account } from "../../shared/types";
import { ErrorBox, Spinner } from "./ui";
import "./tea-signin.css";

/**
 * Signing in with a login the `tea` CLI holds, instead of typing the server
 * and a token. Relay asks tea for the token; it never reaches this window.
 */
export function TeaSignIn({
  onConnected,
}: {
  onConnected: (account: Account) => Promise<void>;
}) {
  const qc = useQueryClient();
  const setup = useQuery({
    queryKey: ["tea-setup"],
    queryFn: () => api.teaSetup(),
  });
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<unknown>();
  async function run(id: string | true, work: () => Promise<void>) {
    setBusy(id);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const data = setup.data;
  if (!data) return null;
  const refresh = () =>
    run(true, async () => {
      await qc.invalidateQueries({ queryKey: ["tea-setup"] });
    });
  return (
    <div className="tea-signin">
      <span className="tea-signin-title">Or use the tea CLI</span>
      {data.logins.map((login) => (
        <button
          key={login.name}
          className="tea-login"
          disabled={!!busy}
          onClick={() =>
            void run(login.name, async () => {
              await onConnected(await api.connectWithTea(login.name));
            })
          }
        >
          <span>
            {login.user || login.name}
            <small>{new URL(login.url).host}</small>
          </span>
          {busy === login.name ? <Spinner size={12} /> : <span>Use</span>}
        </button>
      ))}
      {!data.logins.length && (
        <p className="tea-signin-note">
          {data.error ??
            (data.path
              ? "tea has no logins yet. Run `tea login add` in a terminal, then check again."
              : "Already signed in with tea? Link it and pick a login, no token needed.")}
        </p>
      )}
      <div className="tea-signin-actions">
        {!data.path && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() =>
              void run(true, async () => {
                if (await api.linkSourceControlCli("gitea"))
                  await qc.invalidateQueries({ queryKey: ["tea-setup"] });
              })
            }
          >
            <FolderOpen size={12} /> Link tea…
          </button>
        )}
        {!!data.path && !data.logins.length && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} /> Check again
          </button>
        )}
      </div>
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
