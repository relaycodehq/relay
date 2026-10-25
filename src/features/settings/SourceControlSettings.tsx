import { useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Account } from "../../../shared/types";
import type {
  SourceControlFix,
  SourceControlKind,
  SourceControlProvider,
} from "../../../shared/source-control";
import { AzureDevOpsMark, GiteaMark, GitHubMark } from "../../ui/BrandIcons";
import {
  CliPathField,
  RescanButton,
  ToolRow,
  ToolRows,
  withCode,
} from "../../ui/ToolRow";
import { ErrorBox } from "../../ui/ui";
import { reloadAccount } from "./useSignIn";

const queryKey = ["source-control"];

const marks: Record<SourceControlKind, ReactNode> = {
  github: <GitHubMark />,
  gitea: <GiteaMark />,
  "azure-devops": <AzureDevOpsMark />,
};

/** What the switch stops, said once it's off. */
const offNotes: Record<SourceControlKind, string> = {
  github: "Turned off: Relay doesn't show GitHub CI status.",
  gitea:
    "Turned off: Relay doesn't sign in to Gitea, so nothing offers its pull requests or CI. A saved account stays for when you turn it back on.",
  "azure-devops":
    "Turned off: Relay doesn't show Azure DevOps pull requests or Pipelines. Work items have a switch of their own further down.",
};

const fixLabels: Record<SourceControlFix, string> = {
  link: "Link it…",
  connect: "Connect…",
  "sign-in": "Sign in…",
  "set-up": "Set up…",
};

/** What else follows a host: CI, the tea logins and whose pull requests show. */
const followers = ["ci-status", "tea-setup", "pull-servers", "host-account"];

type Apply = (
  run: () => Promise<SourceControlProvider[] | null>,
  /** Gitea's switch signs Relay in or out, so the account is read again. */
  signsIn?: boolean,
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
  account,
  onConnect,
  onDisconnect,
}: {
  /** The Gitea account Relay is signed in to. */
  account: Account | null;
  /** Opens the Gitea sign-in, which also offers the logins tea holds. */
  onConnect?: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const providers = useProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const apply: Apply = async (run, signsIn) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await run();
      if (!next) return;
      if (signsIn) await reloadAccount(qc, [queryKey[0]]);
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
      <p className="setting-muted">
        Looking for GitHub, Gitea and Azure DevOps…
      </p>
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
            disconnect={
              provider.kind === "gitea" && account && provider.enabled ? (
                <GiteaAccount
                  account={account}
                  busy={busy}
                  onDisconnect={() => void onDisconnect().catch(setError)}
                />
              ) : undefined
            }
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
  disconnect,
}: {
  provider: SourceControlProvider;
  busy: boolean;
  apply: Apply;
  onConnect?: () => void;
  /** Gitea's account and the way out of it, in its details. */
  disconnect?: ReactNode;
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
          void apply(
            () => api.setSourceControlEnabled(kind, on),
            kind === "gitea",
          ),
      }}
      details={
        <>
          {cliField}
          {disconnect}
          {!enabled && fix !== "set-up" && (
            <p className="tool-row-off">{offNotes[kind]}</p>
          )}
        </>
      }
    />
  );
}

/** Where the Gitea token is kept, and signing out. */
function GiteaAccount({
  account,
  busy,
  onDisconnect,
}: {
  account: Account;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="source-control-account">
      <p className="setting-muted">
        {account.persistent
          ? "The token is saved in your system keychain."
          : "The token is kept until Relay quits: this computer can't store it encrypted."}
      </p>
      <button className="danger subtle" disabled={busy} onClick={onDisconnect}>
        <LogOut size={14} />
        Disconnect
      </button>
    </div>
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
