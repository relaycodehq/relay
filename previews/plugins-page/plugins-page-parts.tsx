// The plugin settings every option shares, cut into sections that can
// summarise themselves in one line when folded. Changes save as you make
// them; only a new key or token waits for Connect.
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  SettingsCard,
  SettingsRow,
  Switch,
} from "../../src/ui/SettingsCard";
import {
  clockifyProjects,
  devopsProjects,
  meta,
  regions,
  relayProjects,
  workspaces,
  type ClockifyState,
  type DevopsState,
  type PluginId,
  type PluginsState,
} from "./plugins-page-data";

export type SetPlugin = <K extends PluginId>(
  id: K,
  patch: Partial<PluginsState[K]>,
) => void;

export interface Section {
  id: string;
  title: string;
  summary: string;
  /** Complete enough to start folded. */
  ready: boolean;
  body: ReactNode;
}

export function PluginIcon({ id, size = 30 }: { id: PluginId; size?: number }) {
  const Icon = meta[id].icon;
  return (
    <span className="pl-icon" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

export function PluginToggle({
  id,
  state,
  set,
}: {
  id: PluginId;
  state: PluginsState;
  set: SetPlugin;
}) {
  return (
    <Switch
      label={`Turn on ${meta[id].title}`}
      checked={state[id].on}
      onChange={(on) => set(id, { on })}
    />
  );
}

/** Fades out on its own; remounted by key on every save. */
export function SavedNote({ at }: { at?: number }) {
  return at ? (
    <span key={at} className="pl-saved" role="status">
      Saved
    </span>
  ) : null;
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight size={14} className={`pl-chevron ${open ? "open" : ""}`} />
  );
}

/** A key that's either saved (replace / forget) or waiting to connect. */
export function SecretRow({
  label,
  hint,
  saved,
  placeholder,
  onConnect,
  onForget,
}: {
  label: string;
  hint: string;
  saved: boolean;
  placeholder: string;
  onConnect: () => void;
  onForget: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const open = !saved || editing;
  return (
    <SettingsRow
      label={label}
      hint={saved && !editing ? "Saved in your system keychain." : hint}
    >
      {open ? (
        <>
          <input
            type="password"
            aria-label={label}
            placeholder={placeholder}
            value={value}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            className="primary"
            disabled={!value.trim()}
            onClick={() => {
              onConnect();
              setValue("");
              setEditing(false);
            }}
          >
            Connect
          </button>
          {editing && (
            <button className="text-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <>
          <button onClick={() => setEditing(true)}>Replace</button>
          <button className="text-button" onClick={onForget}>
            Forget
          </button>
        </>
      )}
    </SettingsRow>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
  empty,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  empty?: string;
}) {
  return (
    <select
      className="plugin-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {(empty !== undefined || !value) && (
        <option value="">{empty ?? "Choose…"}</option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const plain = (list: string[]) =>
  list.map((v) => ({ value: v, label: v }));

export function ProjectDot({ id }: { id: string }) {
  const color = clockifyProjects.find((p) => p.id === id)?.color;
  return (
    <span
      className="pl-dot"
      style={{ background: color ?? "transparent" }}
      aria-hidden
    />
  );
}

/** Tracked projects first; the rest fold under one line. */
export function ClockifyProjectList({
  c,
  set,
}: {
  c: ClockifyState;
  set: SetPlugin;
}) {
  const [showRest, setShowRest] = useState(false);
  const tracked = relayProjects.filter((p) => c.projects[p.id]);
  const rest = relayProjects.filter((p) => !c.projects[p.id]);
  const pick = (id: string, to: string) => {
    const projects = { ...c.projects };
    if (to) projects[id] = to;
    else delete projects[id];
    set("clockify", { projects });
  };
  const row = (p: (typeof relayProjects)[number]) => (
    <div key={p.id} className="pl-map-row">
      <span className="pl-map-name">{p.name}</span>
      <span className="pl-map-target">
        <ProjectDot id={c.projects[p.id] ?? ""} />
        <Select
          label={`Clockify project for ${p.name}`}
          value={c.projects[p.id] ?? ""}
          empty="Not tracked"
          options={clockifyProjects.map((o) => ({
            value: o.id,
            label: o.client ? `${o.name} · ${o.client}` : o.name,
          }))}
          onChange={(to) => pick(p.id, to)}
        />
      </span>
    </div>
  );
  return (
    <SettingsCard className="pl-map">
      {tracked.map(row)}
      {!!rest.length && (
        <button
          className="pl-fold"
          aria-expanded={showRest}
          onClick={() => setShowRest(!showRest)}
        >
          <Chevron open={showRest} />
          {rest.length} not tracked
          <span>{rest.map((p) => p.name).join(", ")}</span>
        </button>
      )}
      {showRest && <div className="pl-reveal">{rest.map(row)}</div>}
    </SettingsCard>
  );
}

function clockifySections(c: ClockifyState, set: SetPlugin): Section[] {
  const tracked = Object.keys(c.projects).length;
  return [
    {
      id: "connection",
      title: "Connection",
      summary: c.key
        ? `Connected as ${c.account} · ${c.region}${c.workspace ? ` · ${c.workspace}` : ""}`
        : "Not connected",
      ready: c.key && !!c.workspace,
      body: (
        <SettingsCard>
          <SecretRow
            label="API key"
            hint="From Clockify → Preferences → Advanced → API key."
            saved={c.key}
            placeholder={c.key ? "New key" : "Paste your key"}
            onConnect={() =>
              set("clockify", { key: true, account: "Sample Person" })
            }
            onForget={() =>
              set("clockify", { key: false, account: "", workspace: "" })
            }
          />
          <SettingsRow label="Region" hint="Where your Clockify data lives.">
            <Select
              label="Clockify region"
              value={c.region}
              options={plain(regions)}
              onChange={(region) => set("clockify", { region })}
            />
          </SettingsRow>
          {c.key && (
            <SettingsRow label="Workspace">
              <Select
                label="Clockify workspace"
                value={c.workspace}
                options={plain(workspaces)}
                onChange={(workspace) => set("clockify", { workspace })}
              />
            </SettingsRow>
          )}
        </SettingsCard>
      ),
    },
    {
      id: "day",
      title: "Your day",
      summary: `A project counts for ${c.quiet} quiet minutes after you touch it`,
      ready: true,
      body: (
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
              value={c.quiet}
              onChange={(e) =>
                set("clockify", { quiet: Number(e.target.value) })
              }
            />
          </SettingsRow>
        </SettingsCard>
      ),
    },
    ...(c.key && c.workspace
      ? [
          {
            id: "projects",
            title: "Projects",
            summary: tracked
              ? `${tracked} of ${relayProjects.length} tracked, the rest left out`
              : "None tracked yet",
            ready: tracked > 0,
            body: <ClockifyProjectList c={c} set={set} />,
          },
        ]
      : []),
  ];
}

function devopsSections(d: DevopsState, set: SetPlugin): Section[] {
  return [
    {
      id: "connection",
      title: "Connection",
      summary: d.pat && d.org ? `${d.org} / ${d.project}` : "Not connected",
      ready: d.pat && !!d.org && !!d.project,
      body: (
        <SettingsCard>
          <SettingsRow label="Organization" hint="dev.azure.com/…">
            <input
              aria-label="Azure DevOps organization"
              placeholder="your-org"
              value={d.org}
              onChange={(e) => set("devops", { org: e.target.value })}
            />
          </SettingsRow>
          <SecretRow
            label="Personal access token"
            hint="Work Items → Read & write is enough."
            saved={d.pat}
            placeholder="Paste a token"
            onConnect={() =>
              set("devops", { pat: true, project: d.project || "Contoso" })
            }
            onForget={() => set("devops", { pat: false })}
          />
          {d.pat && (
            <SettingsRow label="Project">
              <Select
                label="Azure DevOps project"
                value={d.project}
                options={plain(devopsProjects)}
                onChange={(project) => set("devops", { project })}
              />
            </SettingsRow>
          )}
        </SettingsCard>
      ),
    },
    {
      id: "items",
      title: "Work items",
      summary: `${d.mine ? "Only yours" : "Everyone's"} · inserted as ${d.insert === "link" ? "a link" : "the title"}`,
      ready: true,
      body: (
        <SettingsCard>
          <SettingsRow
            label="Only items assigned to me"
            hint="Otherwise the picker lists the whole board."
          >
            <Switch
              label="Only items assigned to me"
              checked={d.mine}
              onChange={(mine) => set("devops", { mine })}
            />
          </SettingsRow>
          <SettingsRow label="Insert as" hint="What lands in the composer.">
            <div className="segmented pl-segmented">
              {(["link", "title"] as const).map((v) => (
                <button
                  key={v}
                  className={d.insert === v ? "active" : ""}
                  onClick={() => set("devops", { insert: v })}
                >
                  {v === "link" ? "AB# link" : "Title"}
                </button>
              ))}
            </div>
          </SettingsRow>
        </SettingsCard>
      ),
    },
  ];
}

export function sectionsFor(
  id: PluginId,
  state: PluginsState,
  set: SetPlugin,
): Section[] {
  return id === "clockify"
    ? clockifySections(state.clockify, set)
    : devopsSections(state.devops, set);
}
