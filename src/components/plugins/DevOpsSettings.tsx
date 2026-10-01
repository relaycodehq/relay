import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  devopsSettingsSchema,
  organizationLabel,
  organizationUrl,
  type DevOpsSecrets,
  type DevOpsSettings as Settings,
  type DevOpsStatus,
} from "../../../shared/devops";
import type { SourceControlProvider } from "../../../shared/source-control";
import { api } from "../../lib/api";
import {
  devopsConnectionKey,
  devopsKey,
  usePluginEnabled,
  useDevOpsConnection,
  useDevOpsFields,
  useDevOpsStatus,
  useTrackableProjects,
} from "../../lib/plugins";
import { SettingsCard, SettingsRow, Switch } from "../SettingsCard";
import { CliPathField, withCode } from "../ToolRow";
import { ErrorBox } from "../ui";
import {
  FieldSuggestions,
  MineSection,
  SortSection,
  TeamSection,
} from "./DevOpsOrder";
import {
  CommitInput,
  PluginStatus,
  SecretField,
  usePluginSaved,
} from "./plugin-ui";

/** The card's header line: where the items come from, or what's missing. */
export function DevOpsSummary() {
  const status = useDevOpsStatus().data;
  const settings = status?.settings;
  const connection = useDevOpsConnection(!!settings?.organization).data;
  const items = useQuery({
    queryKey: ["devops-items", null, "mine"],
    queryFn: () => api.devopsWorkItems(null, false, "mine"),
    enabled: connection?.signIn === "signed-in",
    staleTime: 2 * 60_000,
    retry: false,
  });
  if (!status || !settings) return null;
  if (!settings.organization)
    return <PluginStatus attention>Needs your organization</PluginStatus>;
  if (settings.auth === "pat" && !status.hasPat)
    return <PluginStatus attention>Needs a personal access token</PluginStatus>;
  // Without a server it's an answer from before the organization was saved.
  if (connection?.signIn === "signed-out" && connection.server)
    return (
      <PluginStatus attention>
        Can't sign in to {connection.server}
      </PluginStatus>
    );
  const where = [organizationLabel(settings.organization), settings.project]
    .filter(Boolean)
    .join(" / ");
  const count = items.data?.items.length;
  return (
    <PluginStatus>
      {where}
      {count !== undefined &&
        ` · ${count} open ${count === 1 ? "item" : "items"} assigned to you`}
    </PluginStatus>
  );
}

/** Who the sign-in is accepted as, or why it isn't. */
function signInLine(connection: SourceControlProvider | undefined) {
  if (!connection) return "Checking the sign-in…";
  if (connection.signIn === "signed-in")
    return connection.account
      ? `Signed in as ${connection.account}.`
      : "Signed in.";
  return connection.detail ?? "Couldn't tell whether you're signed in.";
}

/**
 * The Azure DevOps plugin's connection, filter and projects. Every change
 * saves at once; only a new token or key waits for Connect.
 */
export function DevOpsSettings() {
  const qc = useQueryClient();
  const saved = usePluginSaved();
  const on = usePluginEnabled("devops");
  const status = useDevOpsStatus();
  const settings = status.data?.settings;
  const connection = useDevOpsConnection(!!settings?.organization);
  const fields = useDevOpsFields(connection.data?.signIn === "signed-in");
  const projects = useTrackableProjects();
  const [threshold, setThreshold] = useState<number>();
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<unknown>();
  const latest = useRef(0);
  if (!status.data || !settings)
    return status.error ? (
      <ErrorBox error={status.error} retry={() => void status.refetch()} />
    ) : (
      <p className="setting-muted">Loading…</p>
    );

  async function save(patch: Partial<Settings>, secrets: DevOpsSecrets = {}) {
    // The plugin's switch owns `enabled`; what's cached here may predate it.
    const next = { ...settings!, ...patch, enabled: on };
    setError(undefined);
    try {
      if (next.organization) organizationUrl(next.organization);
    } catch (e) {
      setError(e);
      return false;
    }
    if (!devopsSettingsSchema.safeParse(next).success) return false;
    const seq = ++latest.current;
    // Show the change at once; an older save landing late mustn't undo a newer one.
    qc.setQueryData<DevOpsStatus>(
      devopsKey,
      (s) => s && { ...s, settings: next },
    );
    try {
      const result = await api.saveDevOpsSettings(next, secrets);
      if (seq === latest.current) qc.setQueryData(devopsKey, result);
      saved();
      void qc.invalidateQueries({ queryKey: ["devops-items"] });
      void qc.invalidateQueries({ queryKey: devopsConnectionKey });
      return true;
    } catch (e) {
      setError(e);
      void status.refetch();
      return false;
    }
  }

  async function linkAz(run: () => Promise<unknown>) {
    setLinking(true);
    setError(undefined);
    try {
      await run();
      await qc.invalidateQueries({ queryKey: devopsConnectionKey });
    } catch (e) {
      setError(e);
    } finally {
      setLinking(false);
    }
  }

  const { hasPat, hasOpenRouterKey, persistent } = status.data;
  const keychain = persistent
    ? "Saved in your system keychain."
    : "Kept until Relay quits: this computer can't store it encrypted.";
  const az = connection.data;
  const filter = settings.filter;
  const setFilter = (next: Partial<Settings["filter"]>) =>
    void save({ filter: { ...filter, ...next } });
  const percent = Math.round((threshold ?? filter.threshold) * 100);
  const commitThreshold = () => {
    if (threshold !== undefined && threshold !== filter.threshold)
      setFilter({ threshold });
    setThreshold(undefined);
  };

  return (
    <>
      <div className="plugin-section">
        <h4 className="settings-card-title">Connection</h4>
        <SettingsCard>
          <SettingsRow
            label="Organization"
            hint="Its name or dev.azure.com URL."
          >
            <CommitInput
              aria-label="Azure DevOps organization"
              placeholder="my-org"
              value={settings.organization}
              onCommit={(organization) => void save({ organization })}
            />
          </SettingsRow>
          <SettingsRow
            label="Project"
            hint="Leave empty to list items from every project."
          >
            <CommitInput
              aria-label="Azure DevOps project"
              placeholder="All projects"
              value={settings.project}
              onCommit={(project) => void save({ project })}
            />
          </SettingsRow>
          <SettingsRow label="Sign in with">
            <div
              className="segmented settings-segmented"
              role="group"
              aria-label="Sign in with"
            >
              <button
                className={settings.auth === "pat" ? "active" : ""}
                aria-pressed={settings.auth === "pat"}
                onClick={() => void save({ auth: "pat" })}
              >
                Access token
              </button>
              <button
                className={settings.auth === "azure-cli" ? "active" : ""}
                aria-pressed={settings.auth === "azure-cli"}
                onClick={() => void save({ auth: "azure-cli" })}
              >
                Azure CLI
              </button>
            </div>
          </SettingsRow>
          {settings.auth === "pat" ? (
            <SettingsRow
              label="Personal access token"
              hint={
                hasPat
                  ? withCode(`${signInLine(az)} ${keychain}`)
                  : "Needs the Work Items (Read) scope."
              }
            >
              <SecretField
                label="Personal access token"
                saved={hasPat}
                placeholder="Paste a token"
                onConnect={(pat) => save({}, { pat })}
                onForget={() => void save({}, { pat: null })}
              />
            </SettingsRow>
          ) : (
            <SettingsRow
              label="Azure CLI"
              hint={withCode(
                `${settings.organization ? `${signInLine(az)} ` : ""}Uses your \`az login\`; Relay stores no token.`,
              )}
              below={
                az &&
                (!az.path || az.linked) && (
                  <CliPathField
                    program="az"
                    path={az.path}
                    linked={az.linked}
                    busy={linking}
                    onUse={(typed) =>
                      void linkAz(() =>
                        api.linkSourceControlCli("azure-devops", typed),
                      )
                    }
                    onUnlink={() =>
                      void linkAz(() =>
                        api.unlinkSourceControlCli("azure-devops"),
                      )
                    }
                  />
                )
              }
            />
          )}
        </SettingsCard>
      </div>
      {settings.organization && (
        <>
          <FieldSuggestions fields={fields.data} />
          <SortSection settings={settings} save={save} fields={fields.data} />
          <MineSection settings={settings} save={save} fields={fields.data} />
          <TeamSection settings={settings} save={save} fields={fields.data} />
          <div className="plugin-section">
            <h4 className="settings-card-title">Matching to projects</h4>
            <SettingsCard>
              <SettingsRow
                label="Only the open project's items"
                hint="Jev, a decision model on OpenRouter, decides which work items belong to the project you're in."
              >
                <Switch
                  label="Show only the items that belong to the open project"
                  checked={filter.enabled}
                  onChange={(enabled) => setFilter({ enabled })}
                />
              </SettingsRow>
              {filter.enabled && (
                <>
                  <SettingsRow
                    label="OpenRouter API key"
                    hint={hasOpenRouterKey ? keychain : undefined}
                  >
                    <SecretField
                      label="OpenRouter API key"
                      saved={hasOpenRouterKey}
                      placeholder="sk-or-…"
                      onConnect={(openRouterKey) => save({}, { openRouterKey })}
                      onForget={() => void save({}, { openRouterKey: null })}
                    />
                  </SettingsRow>
                  <SettingsRow label="Model" hint="An OpenRouter model ID.">
                    <CommitInput
                      aria-label="Filter model"
                      value={filter.model}
                      onCommit={(model) => setFilter({ model })}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label="Confidence"
                    hint="How sure Jev must be before an item counts."
                  >
                    <span className="plugin-range-value">{percent}%</span>
                    <input
                      type="range"
                      aria-label="Match confidence"
                      min={5}
                      max={95}
                      step={5}
                      value={percent}
                      onChange={(e) =>
                        setThreshold(Number(e.target.value) / 100)
                      }
                      onPointerUp={commitThreshold}
                      onKeyUp={commitThreshold}
                      onBlur={commitThreshold}
                    />
                  </SettingsRow>
                </>
              )}
            </SettingsCard>
            {filter.enabled && (
              <p className="plugin-note">
                Sends work item titles, types, area paths, tags and the start of
                descriptions to OpenRouter. Answers are reused until an item
                changes.
              </p>
            )}
          </div>
          <div className="plugin-section">
            <h4 className="settings-card-title">Projects</h4>
            {!projects.data ? (
              <p className="setting-muted">Loading…</p>
            ) : !projects.data.length ? (
              <p className="setting-muted">Add a project to choose here.</p>
            ) : (
              <SettingsCard className="plugin-map">
                {projects.data.map((p) => {
                  const shown = !settings.hiddenProjects.includes(p.id);
                  return (
                    <div key={p.id} className="plugin-map-row">
                      <span data-hidden={!shown || undefined}>{p.name}</span>
                      <span className="plugin-map-target">
                        {filter.enabled && shown && (
                          <CommitInput
                            className="plugin-hints"
                            aria-label={`${p.name} hints`}
                            placeholder="Hints, e.g. Licensing, BM"
                            title="Product names, area paths, tags or abbreviations. Jev also sees project and repository names."
                            value={filter.keywords[p.id] ?? ""}
                            onCommit={(hint) => {
                              const keywords = { ...filter.keywords };
                              if (hint) keywords[p.id] = hint;
                              else delete keywords[p.id];
                              setFilter({ keywords });
                            }}
                          />
                        )}
                        <Switch
                          label={`Show work items in ${p.name}`}
                          checked={shown}
                          onChange={(show) =>
                            void save({
                              hiddenProjects: show
                                ? settings.hiddenProjects.filter(
                                    (id) => id !== p.id,
                                  )
                                : [...settings.hiddenProjects, p.id],
                            })
                          }
                        />
                      </span>
                    </div>
                  );
                })}
              </SettingsCard>
            )}
            <p className="plugin-note">
              Turn work items off where a project isn't tracked in Azure DevOps.
              {filter.enabled && " Hints help Jev match items to the rest."}
            </p>
          </div>
        </>
      )}
      {!!error && <ErrorBox error={error} />}
    </>
  );
}
