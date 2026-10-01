import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type {
  SourceControlFix,
  SourceControlKind,
  SourceControlProvider,
} from "../../shared/source-control";
import { GiteaMark, GitHubMark } from "./BrandIcons";
import {
  CliPathField,
  RescanButton,
  ToolRow,
  ToolRows,
  withCode,
} from "./ToolRow";
import { ErrorBox } from "./ui";

const queryKey = ["source-control"];
// Azure DevOps is a plugin now, so it never reaches this list.
const marks: Partial<Record<SourceControlKind, ReactNode>> = {
  github: <GitHubMark />,
  gitea: <GiteaMark />,
};
/** What the switch stops, said once it's off. */
const offNotes: Partial<Record<SourceControlKind, string>> = {
  github: "Turned off: Relay doesn't show GitHub CI status.",
  gitea: "Turned off: Relay doesn't show Gitea CI status.",
};
const fixLabels: Record<SourceControlFix, string> = {
  link: "Link it…",
  connect: "Connect…",
  "sign-in": "Sign in…",
  "set-up": "Set up…",
};
/** What else follows a host: CI and the tea logins. */
const followers = ["ci-status", "tea-setup"];

type Apply = (
  run: () => Promise<SourceControlProvider[] | null>,
) => Promise<void>;

const useProviders = () =>
  useQuery({ queryKey, queryFn: () => api.sourceControl() });

/** The section header's rescan button. */
export function SourceControlRescan() {
  const qc = useQueryClient();
  const { isFetching } = useProviders();
  return (
    <RescanButton
      busy={isFetching}
      onClick={() => void qc.refetchQueries({ queryKey })}
    />
  );
}

/** Settings → Integrations: where pull requests and CI come from. */
export function SourceControlSettings({
  onConnect,
}: {
  /** Opens the Gitea sign-in, which also offers the logins tea holds. */
  onConnect?: () => void;
}) {
  const qc = useQueryClient();
  const providers = useProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const apply: Apply = async (run) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await run();
      if (!next) return;
      qc.setQueryData(queryKey, next);
      await qc.invalidateQueries({
        predicate: (q) => followers.includes(String(q.queryKey[0])),
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!providers.data)
    return providers.error ? (
      <ErrorBox
        error={providers.error}
        retry={() => void providers.refetch()}
      />
    ) : (
      <p className="setting-muted">Looking for GitHub and Gitea…</p>
    );
  return (
    <>
      <ToolRows>
        {providers.data.map((provider) => (
          <ProviderRow
            key={provider.kind}
            provider={provider}
            busy={busy}
            apply={apply}
            onConnect={onConnect}
          />
        ))}
      </ToolRows>
      {!!error && <ErrorBox error={error} />}
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
  busy: boolean;
  apply: Apply;
  onConnect?: () => void;
}) {
  const { kind, name, cli, version, enabled, fix } = provider;
  const cliField = cli && (
    <CliPathField
      program={cli}
      path={provider.path}
      linked={provider.linked}
      busy={busy}
      autoFocus={fix === "link"}
      onUse={(typed) => void apply(() => api.linkSourceControlCli(kind, typed))}
      onUnlink={() => void apply(() => api.unlinkSourceControlCli(kind))}
    />
  );
  return (
    <ToolRow
      mark={marks[kind]}
      name={name}
      version={version && `${cli} ${version}`}
      state={
        !enabled
          ? "off"
          : provider.signIn === "signed-in"
            ? "ready"
            : "attention"
      }
      summary={(openDetails) => (
        <Summary
          provider={provider}
          busy={busy}
          onFix={fix === "connect" ? onConnect : openDetails}
        />
      )}
      toggle={{
        checked: enabled,
        // Nothing to turn on before it's set up.
        disabled: busy || fix === "set-up",
        onChange: (on) =>
          void apply(() => api.setSourceControlEnabled(kind, on)),
      }}
      details={
        <>
          {cliField}
          {!enabled && fix !== "set-up" && (
            <p className="tool-row-off">{offNotes[kind]}</p>
          )}
        </>
      }
    />
  );
}

/** One line: who Relay is signed in as, or what's wrong and the one fix. */
function Summary({
  provider,
  busy,
  onFix,
}: {
  provider: SourceControlProvider;
  busy: boolean;
  onFix?: () => void;
}) {
  const { cli, account, server, detail, fix, signIn } = provider;
  if (signIn === "signed-in")
    return account ? (
      <>
        Signed in as <b>{account}</b>
        {server && <> on {server}</>}
      </>
    ) : (
      <>Signed in{server && <> to {server}</>}</>
    );
  const headline =
    fix === "link" ? (
      `Can't find ${cli}.`
    ) : fix === "connect" ? (
      "Not connected."
    ) : fix === "set-up" ? (
      "Not set up."
    ) : signIn === "signed-out" ? (
      `Not signed in${server ? ` to ${server}` : ""}.`
    ) : account ? (
      <>
        <b>{account}</b>
        {server && <> on {server}</>}.
      </>
    ) : null;
  if (!headline && !detail) return <>Couldn't tell whether you're signed in.</>;
  return (
    <>
      {headline}
      {detail && <> {withCode(detail)}</>}
      {fix && onFix && (
        <>
          {" "}
          <button className="text-button" disabled={busy} onClick={onFix}>
            {fixLabels[fix]}
          </button>
        </>
      )}
    </>
  );
}
