import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import type { SourceControlProvider } from "../../shared/source-control";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";
import { ErrorBox, Spinner } from "./ui";
import "./agent-updates.css";

const signIns = {
  "signed-in": "Signed in",
  "signed-out": "Not signed in",
  unknown: "Sign-in unknown",
} as const;

/** Settings → Integrations: the hosts Relay reads pull requests and CI from. */
export function SourceControlSettings({
  onConnect,
}: {
  /** Opens the Gitea sign-in, which also offers the logins tea holds. */
  onConnect?: () => void;
}) {
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: ["source-control"],
    queryFn: () => api.sourceControl(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function apply(run: () => Promise<SourceControlProvider[] | null>) {
    setBusy(true);
    setError(undefined);
    try {
      const next = await run();
      if (!next) return;
      qc.setQueryData(["source-control"], next);
      // A host turned off or a different CLI changes what CI and sign-in show.
      await qc.invalidateQueries({
        predicate: (q) =>
          ["ci-status", "tea-setup"].includes(String(q.queryKey[0])),
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (providers.isPending && !providers.data)
    return <p className="setting-muted">Looking for GitHub and Gitea…</p>;
  return (
    <>
      <SettingsCard>
        {providers.data?.map((provider) => (
          <ProviderRow
            key={provider.kind}
            provider={provider}
            busy={busy}
            apply={apply}
            onConnect={onConnect}
          />
        ))}
        <SettingsFooter note="A host you turn off stops showing CI status. Your accounts and tools stay as they are.">
          <button
            disabled={busy || providers.isFetching}
            onClick={() => void apply(() => api.sourceControl())}
          >
            {providers.isFetching ? (
              <Spinner size={12} />
            ) : (
              <RefreshCw size={14} />
            )}
            Check again
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!(error || providers.error) && (
        <ErrorBox error={error || providers.error} />
      )}
    </>
  );
}

function ProviderRow({
  provider,
  busy,
  apply,
  onConnect,
}: {
  provider: SourceControlProvider;
  onConnect?: () => void;
  busy: boolean;
  apply: (run: () => Promise<SourceControlProvider[] | null>) => Promise<void>;
}) {
  const { kind, cli, path, version } = provider;
  const status = [
    version && (cli ? `${cli} ${version}` : `Version ${version}`),
    // A tool that isn't there, and nobody signed in through it, has nothing to report.
    provider.signIn === "unknown" && !provider.account
      ? undefined
      : provider.account
        ? `${signIns[provider.signIn]} as ${provider.account}`
        : signIns[provider.signIn],
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <SettingsRow
      label={provider.name}
      hint={
        <>
          {status}
          {path && (
            <span className="agent-version-note">
              {provider.linked ? "Linked" : "Found"}: {path}
            </span>
          )}
          {provider.detail && (
            <span
              className="agent-version-note"
              data-failed={
                kind === "github" && provider.signIn === "signed-out"
                  ? true
                  : undefined
              }
            >
              {provider.detail}
            </span>
          )}
        </>
      }
    >
      {kind === "gitea" && provider.signIn === "signed-out" && onConnect && (
        <button className="primary" disabled={busy} onClick={onConnect}>
          Connect…
        </button>
      )}
      {cli && provider.linked && (
        <button
          disabled={busy}
          title="Forget the linked program and search again"
          onClick={() => void apply(() => api.unlinkSourceControlCli(kind))}
        >
          <RotateCcw size={14} />
          Find automatically
        </button>
      )}
      {cli && (
        <button
          className={!path && !provider.linked ? "primary" : ""}
          disabled={busy}
          onClick={() => void apply(() => api.linkSourceControlCli(kind))}
        >
          <FolderOpen size={14} />
          {path ? "Change…" : "Link…"}
        </button>
      )}
      <Switch
        label={`Use ${provider.name}`}
        checked={provider.enabled}
        disabled={busy}
        onChange={(enabled) =>
          void apply(() => api.setSourceControlEnabled(kind, enabled))
        }
      />
    </SettingsRow>
  );
}
