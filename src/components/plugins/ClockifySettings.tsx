import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clockifyHosts,
  clockifySettingsSchema,
  type ClockifyHost,
  type ClockifySettings,
} from "../../../shared/clockify";
import { api } from "../../lib/api";
import { clockifyKey, useClockifyStatus } from "../../lib/plugins";
import { SettingsCard, SettingsFooter, SettingsRow } from "../SettingsCard";
import { ErrorBox } from "../ui";

/** The Clockify plugin's connection, workspace and which projects it tracks. */
export function ClockifySettings() {
  const qc = useQueryClient();
  const status = useClockifyStatus();
  const [draft, setDraft] = useState<Partial<ClockifySettings>>({});
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [note, setNote] = useState<string>();
  const connected = !!status.data?.hasToken;
  const workspaces = useQuery({
    queryKey: ["clockify-workspaces", status.data?.settings.host],
    queryFn: () => api.clockifyWorkspaces(),
    enabled: connected,
  });
  const clockifyProjects = useQuery({
    queryKey: [
      "clockify-projects",
      status.data?.settings.host,
      status.data?.settings.workspaceId,
    ],
    queryFn: () => api.clockifyProjects(),
    enabled: connected && !!status.data?.settings.workspaceId,
  });
  const relayProjects = useQuery({
    queryKey: ["clockify-relay-projects"],
    queryFn: async () => (await api.projects()).filter((p) => !p.scratch),
  });
  const saved = status.data;
  if (!saved)
    return status.error ? (
      <ErrorBox error={status.error} retry={() => void status.refetch()} />
    ) : (
      <p className="setting-muted">Loading…</p>
    );
  const values = { ...saved.settings, ...draft };
  const change = (next: Partial<ClockifySettings>) => {
    setDraft({ ...draft, ...next });
    setNote(undefined);
  };

  async function save(secret?: string | null) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const next = await api.saveClockifySettings(
        // A new region or key can mean another account's workspace.
        secret !== undefined || draft.host
          ? { ...values, workspaceId: draft.workspaceId ?? "" }
          : values,
        secret === undefined ? {} : { token: secret },
      );
      qc.setQueryData(clockifyKey, next);
      await qc.invalidateQueries({ queryKey: ["clockify-workspaces"] });
      await qc.invalidateQueries({ queryKey: ["clockify-projects"] });
      setDraft({});
      setToken("");
      setNote(
        secret === null
          ? "Key forgotten"
          : next.account
            ? `Connected as ${next.account}`
            : "Saved",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const tracked = Object.keys(values.projects).length;
  return (
    <>
      <SettingsCard>
        <SettingsRow
          label="API key"
          hint={
            connected
              ? saved.persistent
                ? "Saved in your system keychain."
                : "Kept until Relay quits: this computer can't store it encrypted."
              : "From Clockify → Preferences → Advanced → API key."
          }
        >
          <input
            type="password"
            aria-label="Clockify API key"
            placeholder={connected ? "Replace the saved key" : "Paste your key"}
            value={token}
            autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
          />
          {connected && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void save(null)}
            >
              Forget
            </button>
          )}
        </SettingsRow>
        <SettingsRow label="Region" hint="Where your Clockify data lives.">
          <select
            className="plugin-select"
            aria-label="Clockify region"
            value={values.host}
            onChange={(e) => change({ host: e.target.value as ClockifyHost })}
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
              value={values.workspaceId}
              disabled={!workspaces.data}
              onChange={(e) =>
                change({ workspaceId: e.target.value, projects: {} })
              }
            >
              {!values.workspaceId && <option value="">Choose…</option>}
              {workspaces.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}
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
            value={values.idleMinutes}
            onChange={(e) => change({ idleMinutes: Number(e.target.value) })}
          />
        </SettingsRow>
        <SettingsFooter note={note && <span role="status">{note}</span>}>
          <button
            className="primary"
            disabled={
              busy ||
              !clockifySettingsSchema.safeParse(values).success ||
              (!Object.keys(draft).length && !token.trim())
            }
            onClick={() => void save(token.trim() || undefined)}
          >
            {busy ? "Saving…" : token.trim() ? "Save and connect" : "Save"}
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!error && <ErrorBox error={error} />}
      {connected && values.workspaceId && (
        <SettingsCard className="plugin-projects">
          <SettingsRow
            label="Projects"
            hint={
              tracked
                ? `Time goes to Clockify for ${tracked} ${tracked === 1 ? "project" : "projects"}. The rest is left out.`
                : "Pick the Clockify project for each project you want tracked."
            }
          />
          {clockifyProjects.error ? (
            <ErrorBox
              error={clockifyProjects.error}
              retry={() => void clockifyProjects.refetch()}
            />
          ) : (
            relayProjects.data?.map((p) => (
              <SettingsRow key={p.id} label={p.name}>
                <select
                  className="plugin-select"
                  aria-label={`Clockify project for ${p.name}`}
                  value={values.projects[p.id] ?? ""}
                  disabled={!clockifyProjects.data}
                  onChange={(e) => {
                    const projects = { ...values.projects };
                    if (e.target.value) projects[p.id] = e.target.value;
                    else delete projects[p.id];
                    change({ projects });
                  }}
                >
                  <option value="">Not tracked</option>
                  {clockifyProjects.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.clientName ? `${c.name} · ${c.clientName}` : c.name}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            ))
          )}
          <SettingsFooter>
            <button
              className="primary"
              disabled={busy || !Object.keys(draft).length}
              onClick={() => void save()}
            >
              Save
            </button>
          </SettingsFooter>
        </SettingsCard>
      )}
    </>
  );
}
