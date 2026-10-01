import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clockifyHosts,
  clockifySettingsSchema,
  type ClockifyHost,
  type ClockifySettings,
  type ClockifyStatus,
} from "../../../shared/clockify";
import { api } from "../../lib/api";
import {
  clockifyKey,
  useClockifyStatus,
  useClockifyWorkspaces,
  useTrackableProjects,
} from "../../lib/plugins";
import { SettingsCard, SettingsRow } from "../SettingsCard";
import { ErrorBox } from "../ui";
import { ClockifyProjectMap } from "./ClockifyProjectMap";
import { PluginStatus, usePluginSaved } from "./plugin-ui";

/** The Clockify card's header line: who it reports to, or what's missing. */
export function ClockifySummary() {
  const status = useClockifyStatus().data;
  const connected = !!status?.hasToken;
  const workspaces = useClockifyWorkspaces(
    status?.settings.host ?? "",
    connected,
  );
  const relayProjects = useTrackableProjects();
  if (!status) return null;
  const { workspaceId, projects } = status.settings;
  if (!connected)
    return <PluginStatus attention>Needs an API key</PluginStatus>;
  if (!workspaceId)
    return <PluginStatus attention>Choose a workspace</PluginStatus>;
  const tracked = Object.keys(projects).length;
  if (!tracked)
    return <PluginStatus attention>Choose the projects to track</PluginStatus>;
  const workspace = workspaces.data?.find((w) => w.id === workspaceId)?.name;
  const total = relayProjects.data?.length;
  const count = total
    ? `${tracked} of ${total} projects`
    : `${tracked} ${tracked === 1 ? "project" : "projects"}`;
  return (
    <PluginStatus>
      {workspace ? `${workspace} · ` : ""}
      {count} tracked
    </PluginStatus>
  );
}

/**
 * The Clockify plugin's connection, day and tracked projects. Every change
 * saves at once; only a new API key waits for Connect.
 */
export function ClockifySettings() {
  const qc = useQueryClient();
  const saved = usePluginSaved();
  const status = useClockifyStatus();
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [account, setAccount] = useState<string>();
  const [quiet, setQuiet] = useState<string>();
  const [error, setError] = useState<unknown>();
  const latest = useRef(0);
  const settings = status.data?.settings;
  const connected = !!status.data?.hasToken;
  const workspaces = useClockifyWorkspaces(settings?.host ?? "", connected);
  const clockifyProjects = useQuery({
    queryKey: ["clockify-projects", settings?.host, settings?.workspaceId],
    queryFn: () => api.clockifyProjects(),
    enabled: connected && !!settings?.workspaceId,
  });
  const relayProjects = useTrackableProjects();
  if (!status.data || !settings)
    return status.error ? (
      <ErrorBox error={status.error} retry={() => void status.refetch()} />
    ) : (
      <p className="setting-muted">Loading…</p>
    );

  async function save(
    patch: Partial<ClockifySettings>,
    secrets: { token?: string | null } = {},
  ) {
    const next = { ...settings!, ...patch };
    if (!clockifySettingsSchema.safeParse(next).success) return;
    const seq = ++latest.current;
    setError(undefined);
    // Show the change at once; an older save landing late mustn't undo a newer one.
    qc.setQueryData<ClockifyStatus>(
      clockifyKey,
      (s) => s && { ...s, settings: next },
    );
    try {
      const result = await api.saveClockifySettings(next, secrets);
      if (seq === latest.current) qc.setQueryData(clockifyKey, result);
      if (secrets.token !== undefined) {
        await qc.invalidateQueries({ queryKey: ["clockify-workspaces"] });
        await qc.invalidateQueries({ queryKey: ["clockify-projects"] });
      }
      saved();
      return result;
    } catch (e) {
      setError(e);
      void status.refetch();
    }
  }

  async function connect() {
    setConnecting(true);
    // A new key can mean another account, so its own active workspace.
    const result = await save({ workspaceId: "" }, { token: token.trim() });
    setConnecting(false);
    if (!result) return;
    setToken("");
    setReplacing(false);
    setAccount(result.account);
  }

  const keyHint = !connected
    ? "From Clockify → Preferences → Advanced → API key."
    : replacing
      ? "The new key replaces the saved one when it connects."
      : `${account ? `Connected as ${account}. ` : ""}${
          status.data.persistent
            ? "Saved in your system keychain."
            : "Kept until Relay quits: this computer can't store it encrypted."
        }`;

  return (
    <>
      <div className="plugin-section">
        <h4 className="settings-card-title">Connection</h4>
        <SettingsCard>
          <SettingsRow label="API key" hint={keyHint}>
            {!connected || replacing ? (
              <>
                <input
                  type="password"
                  aria-label="Clockify API key"
                  placeholder="Paste your key"
                  value={token}
                  autoComplete="off"
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && token.trim()) void connect();
                  }}
                />
                <button
                  key="connect"
                  className="primary"
                  disabled={connecting || !token.trim()}
                  onClick={() => void connect()}
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
                {replacing && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setReplacing(false);
                      setToken("");
                    }}
                  >
                    Cancel
                  </button>
                )}
              </>
            ) : (
              <>
                {/* Keyed so the clicked Connect never turns into a focused Forget. */}
                <button key="replace" onClick={() => setReplacing(true)}>
                  Replace
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setAccount(undefined);
                    void save({ workspaceId: "" }, { token: null });
                  }}
                >
                  Forget
                </button>
              </>
            )}
          </SettingsRow>
          <SettingsRow label="Region" hint="Where your Clockify data lives.">
            <select
              className="plugin-select"
              aria-label="Clockify region"
              value={settings.host}
              onChange={(e) =>
                void save({
                  host: e.target.value as ClockifyHost,
                  // Another region is another account's workspaces.
                  workspaceId: "",
                })
              }
            >
              {Object.entries(clockifyHosts).map(([id, host]) => (
                <option key={id} value={id}>
                  {host.label}
                </option>
              ))}
            </select>
          </SettingsRow>
          {connected && (
            <SettingsRow label="Workspace">
              <select
                className="plugin-select"
                aria-label="Clockify workspace"
                value={settings.workspaceId}
                disabled={!workspaces.data}
                onChange={(e) =>
                  void save({ workspaceId: e.target.value, projects: {} })
                }
              >
                {!settings.workspaceId && <option value="">Choose…</option>}
                {workspaces.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </SettingsRow>
          )}
        </SettingsCard>
      </div>
      <div className="plugin-section">
        <h4 className="settings-card-title">Your day</h4>
        <SettingsCard>
          <SettingsRow
            label="Quiet minutes"
            hint="How long after you last touched a project it still counts as working on it."
          >
            <input
              type="number"
              className="plugin-number"
              aria-label="Quiet minutes"
              min={1}
              max={120}
              value={quiet ?? settings.idleMinutes}
              onChange={(e) => setQuiet(e.target.value)}
              onBlur={() => {
                if (
                  quiet !== undefined &&
                  Number(quiet) !== settings.idleMinutes
                )
                  void save({ idleMinutes: Number(quiet) });
                setQuiet(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </SettingsRow>
        </SettingsCard>
      </div>
      {connected && settings.workspaceId && (
        <div className="plugin-section">
          <h4 className="settings-card-title">Projects</h4>
          {clockifyProjects.error ? (
            <ErrorBox
              error={clockifyProjects.error}
              retry={() => void clockifyProjects.refetch()}
            />
          ) : (
            <ClockifyProjectMap
              relayProjects={relayProjects.data ?? []}
              clockifyProjects={clockifyProjects.data}
              value={settings.projects}
              onChange={(projects) => void save({ projects })}
            />
          )}
        </div>
      )}
      {!!error && <ErrorBox error={error} />}
    </>
  );
}
