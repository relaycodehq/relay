import { Fragment, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type {
  SourceControlKind,
  SourceControlProvider,
} from "../../shared/source-control";
import { GiteaMark, GitHubMark } from "./BrandIcons";
import { Switch } from "./SettingsCard";
import { ErrorBox, IconButton, Spinner } from "./ui";
import "./source-control.css";

const queryKey = ["source-control"];
const marks: Record<SourceControlKind, typeof GitHubMark> = {
  github: GitHubMark,
  gitea: GiteaMark,
};

type Apply = (
  run: () => Promise<SourceControlProvider[] | null>,
) => Promise<void>;

function useProviders() {
  return useQuery({ queryKey, queryFn: () => api.sourceControl() });
}

/** Text with `code` spans, as the details from `gh` and `tea` come. */
function withCode(text: string) {
  return text
    .split("`")
    .map((part, i) =>
      i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
    );
}

/** The section header's rescan button. */
export function SourceControlRescan() {
  const qc = useQueryClient();
  const { isFetching } = useProviders();
  return (
    <IconButton
      label="Check again"
      disabled={isFetching}
      className="source-control-rescan"
      onClick={() => void qc.refetchQueries({ queryKey })}
    >
      {isFetching ? <Spinner size={13} /> : <RefreshCw size={14} />}
    </IconButton>
  );
}

/** Settings → Integrations: the hosts Relay reads pull requests and CI from. */
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
      <div className="settings-card source-control">
        {providers.data.map((provider) => (
          <ProviderRow
            key={provider.kind}
            provider={provider}
            busy={busy}
            apply={apply}
            onConnect={onConnect}
          />
        ))}
      </div>
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
  const [open, setOpen] = useState(false);
  const { kind, name, cli, path, version, enabled } = provider;
  const Mark = marks[kind];
  const state = !enabled
    ? "off"
    : provider.signIn === "signed-in"
      ? "ready"
      : "attention";
  const link = () => void apply(() => api.linkSourceControlCli(kind));
  return (
    <div className="source-control-row" data-state={state}>
      <div className="source-control-main">
        <span className="source-control-mark">
          <Mark size={18} />
          <span className="source-control-dot" aria-hidden />
        </span>
        <div className="source-control-text">
          <div className="source-control-title">
            <span>{name}</span>
            {version && (
              <code>
                {cli} {version}
              </code>
            )}
          </div>
          <p>
            <Summary
              provider={provider}
              busy={busy}
              onConnect={onConnect}
              onLink={link}
            />
          </p>
        </div>
        {cli && (
          <IconButton
            label={`${open ? "Hide" : "Show"} ${name} details`}
            className="source-control-toggle"
            active={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={15} data-open={open || undefined} />
          </IconButton>
        )}
        <Switch
          label={`Use ${name}`}
          checked={enabled}
          disabled={busy}
          onChange={(on) =>
            void apply(() => api.setSourceControlEnabled(kind, on))
          }
        />
      </div>
      {open && cli && (
        <div className="source-control-details">
          <div className="source-control-program">
            <span>{cli}</span>
            {path ? (
              <code title={path}>{path}</code>
            ) : (
              <em>Not found on this computer</em>
            )}
            {path && <small>{provider.linked ? "Linked" : "Found"}</small>}
            <span className="source-control-actions">
              {provider.linked && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void apply(() => api.unlinkSourceControlCli(kind))
                  }
                >
                  Find automatically
                </button>
              )}
              <button className="text-button" disabled={busy} onClick={link}>
                {path ? "Change…" : `Link ${cli}…`}
              </button>
            </span>
          </div>
          {!enabled && (
            <p className="source-control-off">
              Turned off: Relay doesn't show {name} CI status. Your sign-in and{" "}
              {cli} stay as they are.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One line: who Relay is signed in as, or the one thing to do about it. */
function Summary({
  provider,
  busy,
  onConnect,
  onLink,
}: {
  provider: SourceControlProvider;
  busy: boolean;
  onConnect?: () => void;
  onLink: () => void;
}): ReactNode {
  const { kind, cli, path, account, server, detail } = provider;
  const who = account && (
    <>
      <b>{account}</b>
      {server && <> on {server}</>}
    </>
  );
  const action = (label: string, run: () => void) => (
    <button className="text-button" disabled={busy} onClick={run}>
      {label}
    </button>
  );
  const more = detail && <> {withCode(detail)}</>;
  switch (provider.signIn) {
    case "signed-in":
      return <>Signed in as {who}</>;
    case "signed-out":
      return kind === "gitea" ? (
        <>
          Not connected.{more} {onConnect && action("Connect…", onConnect)}
        </>
      ) : (
        <>Not signed in.{more}</>
      );
    default:
      if (cli && !path && !account)
        return (
          <>
            Can't find {cli}.{more} {action("Link it…", onLink)}
          </>
        );
      return account ? (
        <>
          {who}.{more}
        </>
      ) : (
        <>
          {detail
            ? withCode(detail)
            : "Couldn't tell whether you're signed in."}
        </>
      );
  }
}
