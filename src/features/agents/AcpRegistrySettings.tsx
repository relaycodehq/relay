import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, Trash2, X } from "lucide-react";
import type {
  InstalledRegistryAgent,
  RegistryListing,
  RegistryVia,
} from "../../../shared/acp-registry";
import { agentInfo, type CliProvider } from "../../../shared/agents";
import { api } from "../../lib/api";
import { SettingsCard, SettingsRow } from "../../ui/SettingsCard";
import { ErrorBox, IconButton, Spinner } from "../../ui/ui";
import { RegistryGlyph } from "./RegistryGlyph";
import { ProviderIcon } from "./ComposerModelPicker";
import { useRegistryAgents } from "./registry-agents";

const viaNames: Record<RegistryVia, string> = {
  download: "Download",
  npm: "npm package",
  uv: "Python package, through uv",
};
const howItComes = (agent: RegistryListing) =>
  !agent.via
    ? "No build for this computer"
    : agent.verified
      ? "Download, checksum checked"
      : viaNames[agent.via];

const matches = (text: (string | undefined)[], words: string[]) =>
  words.every((word) => text.join(" ").toLowerCase().includes(word));

/** One of Relay's own agents whose CLI isn't on this computer, which Relay can install. */
export interface MissingAgent {
  provider: CliProvider;
  /** What installing runs, e.g. `npm install -g …`. */
  command?: string;
  installing: boolean;
  /** Why the last install failed. */
  failed?: string;
}

function MissingAgentRow({
  agent,
  onInstall,
}: {
  agent: MissingAgent;
  onInstall: () => void;
}) {
  const { name, cli } = agentInfo(agent.provider);
  return (
    <SettingsRow
      label={
        <span className="acp-registry-name">
          <ProviderIcon provider={agent.provider} />
          {cli}
        </span>
      }
      hint={
        <>
          {`${name}'s own CLI, which Relay runs itself. It isn't on this computer.`}
          <span
            className="acp-registry-via"
            data-failed={agent.failed ? true : undefined}
          >
            {agent.failed ?? "npm package, into Relay's own folder"}
          </span>
        </>
      }
    >
      {agent.installing ? (
        <span className="setting-muted acp-registry-status">
          <Spinner size={12} steady />
          Installing…
        </span>
      ) : (
        <button
          title={agent.command && `Runs ${agent.command}`}
          onClick={onInstall}
        >
          {agent.failed ? "Try again" : "Install"}
        </button>
      )}
    </SettingsRow>
  );
}

function InstalledAgents({
  installed,
  removing,
  onRemove,
}: {
  installed: InstalledRegistryAgent[];
  removing: (id: string) => boolean;
  onRemove: (agent: InstalledRegistryAgent) => void;
}) {
  return (
    <SettingsCard>
      {installed.map((agent) => (
        <div key={agent.id} className="acp-registry-installed">
          <RegistryGlyph provider={agent.provider} size={15} />
          <strong>{agent.name}</strong>
          <small>
            {agent.version} · {viaNames[agent.via]}
          </small>
          {removing(agent.id) ? (
            <Spinner size={12} steady />
          ) : (
            <IconButton
              label={`Remove ${agent.name}`}
              onClick={() => onRemove(agent)}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      ))}
      <p className="acp-registry-caption">
        Removing one deletes what Relay downloaded for it. Its threads stay and
        run again once it's back.
      </p>
    </SettingsCard>
  );
}

/**
 * The agents in the ACP registry, to install next to Relay's own. Relay
 * downloads each into a folder of its own, so nothing lands on the PATH, and
 * picks it up in the composer straight away. Relay's own agents the computer
 * doesn't have lead the list, installed the same way.
 */
export function AcpRegistrySettings({
  missing = [],
  onInstallMissing,
}: {
  missing?: MissingAgent[];
  onInstallMissing?: (provider: CliProvider) => void;
}) {
  const { installed, busy } = useRegistryAgents();
  const [tab, setTab] = useState<"browse" | "installed">(() =>
    installed.length ? "installed" : "browse",
  );
  const browsing = tab === "browse" || !installed.length;
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>();
  const listing = useQuery({
    queryKey: ["acp-registry"],
    queryFn: () => api.registryListing(),
    // The registry is only asked once someone browses.
    enabled: browsing,
    staleTime: 10 * 60_000,
  });

  const words = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  const shown = useMemo(
    () =>
      (listing.data ?? []).filter((agent) =>
        matches(
          [agent.name, agent.id, agent.description, ...agent.authors],
          words,
        ),
      ),
    [listing.data, words],
  );
  const ownShown = missing.filter((agent) => {
    const { name, cli } = agentInfo(agent.provider);
    return matches([name, cli, agent.provider], words);
  });
  const byId = new Map(installed.map((agent) => [agent.id, agent]));

  const install = async (id: string) => {
    setError(undefined);
    try {
      await api.installRegistryAgent(id);
    } catch (reason) {
      setError(reason);
    }
  };
  const remove = async (agent: InstalledRegistryAgent) => {
    setError(undefined);
    try {
      await api.removeRegistryAgent(agent.id);
    } catch (reason) {
      setError(reason);
    }
  };

  return (
    <div className="acp-registry">
      {installed.length > 0 && (
        <div
          className="segmented settings-segmented acp-registry-tabs"
          role="tablist"
          aria-label="ACP registry agents"
        >
          {(
            [
              ["browse", "Browse ACP registry"],
              ["installed", `Installed · ${installed.length}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={(value === "browse") === browsing}
              className={(value === "browse") === browsing ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!!error && <ErrorBox error={error} />}
      {!browsing && (
        <InstalledAgents
          installed={installed}
          removing={(id) => busy[id] === "removing"}
          onRemove={(agent) => void remove(agent)}
        />
      )}
      {browsing && (
        <>
          <div className="settings-search">
            <Search size={14} />
            <input
              aria-label="Search ACP agents"
              placeholder="Search agents in the ACP registry"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {listing.isFetching ? (
              <Spinner size={12} />
            ) : (
              query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={12} />
                </button>
              )
            )}
          </div>
          {listing.isError && (
            <ErrorBox
              error={listing.error}
              retry={() => void listing.refetch()}
            />
          )}
          {listing.data && (
            <SettingsCard>
              {ownShown.map((agent) => (
                <MissingAgentRow
                  key={agent.provider}
                  agent={agent}
                  onInstall={() => onInstallMissing?.(agent.provider)}
                />
              ))}
              {shown.length + ownShown.length === 0 && (
                <SettingsRow
                  label="No agents found"
                  hint="The ACP registry has no agent matching that."
                />
              )}
              {shown.map((agent) => {
                const have = byId.get(agent.id);
                return (
                  <SettingsRow
                    key={agent.id}
                    label={
                      <span className="acp-registry-name">
                        <RegistryGlyph icon={agent.icon} size={14} />
                        {agent.name}
                      </span>
                    }
                    hint={
                      <>
                        {[
                          agent.authors.join(", "),
                          agent.license,
                          agent.version,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {agent.description && (
                          <span className="acp-registry-description">
                            {agent.description}
                          </span>
                        )}
                        <span className="acp-registry-via">
                          {howItComes(agent)}
                        </span>
                      </>
                    }
                  >
                    {busy[agent.id] === "installing" ? (
                      <span className="setting-muted acp-registry-status">
                        <Spinner size={12} steady />
                        Installing…
                      </span>
                    ) : have?.version === agent.version ? (
                      <span className="setting-muted acp-registry-status">
                        <Check size={13} />
                        Installed
                      </span>
                    ) : agent.via ? (
                      <button
                        disabled={!!busy[agent.id]}
                        onClick={() => void install(agent.id)}
                      >
                        {have ? "Update" : "Install"}
                      </button>
                    ) : null}
                  </SettingsRow>
                );
              })}
            </SettingsCard>
          )}
        </>
      )}
    </div>
  );
}
