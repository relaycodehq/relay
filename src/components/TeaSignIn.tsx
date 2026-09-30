import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import type { Account } from "../../shared/types";
import { ErrorBox, Spinner } from "./ui";
import "./tea-signin.css";

const useTea = () =>
  useQuery({ queryKey: ["tea-setup"], queryFn: () => api.teaSetup() });

/**
 * The servers the `tea` CLI is logged in to, as one-click sign-ins above the
 * token form. Relay asks tea for the token; it never reaches this window.
 */
export function TeaLogins({
  onConnected,
}: {
  onConnected: (account: Account) => Promise<void>;
}) {
  const logins = useTea().data?.logins ?? [];
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  if (!logins.length) return null;
  return (
    <div className="tea-logins">
      <span className="tea-logins-label">Signed in with tea</span>
      <div className="tea-logins-list">
        {logins.map((login) => (
          <button
            key={login.name}
            type="button"
            disabled={!!busy}
            onClick={async () => {
              setBusy(login.name);
              setError(undefined);
              try {
                await onConnected(await api.connectWithTea(login.name));
              } catch (e) {
                setError(e);
              } finally {
                setBusy(undefined);
              }
            }}
          >
            <span className="tea-login-avatar" aria-hidden>
              {(login.user || login.name).slice(0, 1).toUpperCase()}
            </span>
            <span className="tea-login-text">
              <b>{login.user || login.name}</b>
              <small>{new URL(login.url).host}</small>
            </span>
            {busy === login.name ? (
              <Spinner size={13} />
            ) : (
              <ArrowRight size={15} className="tea-login-go" />
            )}
          </button>
        ))}
      </div>
      {!!error && <ErrorBox error={error} />}
      <span className="tea-logins-or">or use a token</span>
    </div>
  );
}

/** Under the form: how to bring tea in, when it has nothing to offer yet. */
export function TeaHint() {
  const qc = useQueryClient();
  const tea = useTea().data;
  const [error, setError] = useState<unknown>();
  if (!tea || tea.logins.length) return null;
  const again = () => void qc.invalidateQueries({ queryKey: ["tea-setup"] });
  return (
    <>
      <div className="tea-hint">
        {tea.path ? (
          <>
            Use the tea CLI? It has no logins yet. Run{" "}
            <code>tea login add</code>, then{" "}
            <button type="button" className="text-button" onClick={again}>
              check again
            </button>
            .
          </>
        ) : (
          <>
            Signed in with the tea CLI?{" "}
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                setError(undefined);
                try {
                  if (await api.linkSourceControlCli("gitea")) again();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Link tea…
            </button>
          </>
        )}
      </div>
      {!!error && <ErrorBox error={error} />}
    </>
  );
}
