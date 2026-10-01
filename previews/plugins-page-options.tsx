// Three layouts for Settings → Plugins, all on the same sections.
//   Stack:   collapsible cards; open, a plugin shows every section.
//   Pages:   plugins get their own page under Plugins in the nav; sections
//            fold to a one-line summary once they're set up.
//   Readout: a plugin that's set up reads as a short list of facts; click a
//            fact to change it in place. Off plugins shrink to one line.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { SettingsCard, SettingsRow } from "../src/components/SettingsCard";
import {
  clockifyProjects,
  devopsProjects,
  meta,
  needsSetup,
  pluginIds,
  regions,
  relayProjects,
  status,
  workspaces,
  type PluginId,
  type PluginsState,
} from "./plugins-page-data";
import {
  Chevron,
  ClockifyProjectList,
  PluginIcon,
  PluginToggle,
  ProjectDot,
  SavedNote,
  SecretRow,
  Select,
  plain,
  sectionsFor,
  type SetPlugin,
} from "./plugins-page-parts";

export interface OptionProps {
  state: PluginsState;
  set: SetPlugin;
  savedAt: Partial<Record<PluginId, number>>;
}

/** Fold state that outlives a reload, like the real thing would. */
function useStored(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? initial : saved === "1";
  });
  return [
    value,
    (next: boolean) => {
      localStorage.setItem(key, next ? "1" : "0");
      setValue(next);
    },
  ] as const;
}

/** Opens when the plugin is switched on, folds when it's switched off. */
function useFollowOn(on: boolean, setOpen: (open: boolean) => void) {
  const [was, setWas] = useState(on);
  useEffect(() => {
    if (on !== was) {
      setWas(on);
      setOpen(on);
    }
  }, [on, was, setOpen]);
}

/* ---------- A. Stack ---------- */

function StackCard({
  id,
  state,
  set,
  savedAt,
}: OptionProps & { id: PluginId }) {
  const on = state[id].on;
  const [open, setOpen] = useStored(`pl-stack-${id}`, needsSetup(id, state));
  useFollowOn(on, setOpen);
  return (
    <section
      className={`pl-card ${open ? "open" : ""}`}
      aria-label={meta[id].title}
    >
      <div className="pl-card-head">
        <button
          className="pl-head-button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Chevron open={open} />
          <PluginIcon id={id} />
          <span className="pl-head-text">
            <strong>{meta[id].title}</strong>
            <small className={needsSetup(id, state) ? "pl-attention" : ""}>
              {status(id, state)}
            </small>
          </span>
        </button>
        <SavedNote at={savedAt[id]} />
        <PluginToggle id={id} state={state} set={set} />
      </div>
      {open && (
        <div className="pl-card-body pl-reveal">
          <p className="pl-description">{meta[id].description}</p>
          {on ? (
            sectionsFor(id, state, set).map((s) => (
              <div key={s.id} className="pl-section">
                <h5>{s.title}</h5>
                {s.body}
              </div>
            ))
          ) : (
            <p className="setting-muted">Off. Turn it on to set it up.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function Stack(props: OptionProps) {
  return (
    <div className="pl-stack">
      {pluginIds.map((id) => (
        <StackCard key={id} id={id} {...props} />
      ))}
    </div>
  );
}

/* ---------- B. Pages ---------- */

function Disclosure({
  pluginId,
  id,
  title,
  summary,
  ready,
  children,
}: {
  pluginId: PluginId;
  id: string;
  title: string;
  summary: string;
  ready: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useStored(`pl-pages-${pluginId}-${id}`, !ready);
  return (
    <section className={`pl-disclosure ${open ? "open" : ""}`}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span>{title}</span>
        <small className={ready ? "" : "pl-attention"}>{summary}</small>
      </button>
      {open && <div className="pl-reveal">{children}</div>}
    </section>
  );
}

export function PagesOverview({
  state,
  set,
  openPlugin,
}: OptionProps & { openPlugin: (id: PluginId) => void }) {
  return (
    <SettingsCard className="pl-overview">
      {pluginIds.map((id) => (
        <div key={id} className="pl-overview-row">
          <button className="pl-overview-open" onClick={() => openPlugin(id)}>
            <PluginIcon id={id} size={34} />
            <span className="pl-head-text">
              <strong>{meta[id].title}</strong>
              <small>{meta[id].tagline}</small>
              <small className={needsSetup(id, state) ? "pl-attention" : ""}>
                {status(id, state)}
              </small>
            </span>
            <ChevronRight size={15} className="pl-overview-arrow" />
          </button>
          <PluginToggle id={id} state={state} set={set} />
        </div>
      ))}
    </SettingsCard>
  );
}

export function PagesPlugin({
  id,
  state,
  set,
  savedAt,
}: OptionProps & { id: PluginId }) {
  return (
    <div className="pl-page">
      <SettingsCard>
        <SettingsRow
          label={state[id].on ? "On" : "Off"}
          hint={
            state[id].on
              ? "Turning it off hides it everywhere else in Relay."
              : "Nothing of it shows anywhere until it's on."
          }
        >
          <SavedNote at={savedAt[id]} />
          <PluginToggle id={id} state={state} set={set} />
        </SettingsRow>
      </SettingsCard>
      {state[id].on &&
        sectionsFor(id, state, set).map((s) => (
          <Disclosure
            key={s.id}
            pluginId={id}
            id={s.id}
            title={s.title}
            summary={s.summary}
            ready={s.ready}
          >
            {s.body}
          </Disclosure>
        ))}
    </div>
  );
}

/* ---------- C. Readout ---------- */

interface Fact {
  id: string;
  label: string;
  value: ReactNode;
  missing?: boolean;
  edit: ReactNode;
  wide?: boolean;
}

function facts(id: PluginId, state: PluginsState, set: SetPlugin): Fact[] {
  if (id === "clockify") {
    const c = state.clockify;
    const tracked = relayProjects.filter((p) => c.projects[p.id]);
    return [
      {
        id: "key",
        label: "Account",
        value: c.key ? `${c.account}, key in keychain` : "Not connected",
        missing: !c.key,
        edit: (
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
          </SettingsCard>
        ),
      },
      {
        id: "region",
        label: "Region",
        value: c.region,
        edit: (
          <Select
            label="Clockify region"
            value={c.region}
            options={plain(regions)}
            onChange={(region) => set("clockify", { region })}
          />
        ),
      },
      ...(c.key
        ? [
            {
              id: "workspace",
              label: "Workspace",
              value: c.workspace || "Not picked",
              missing: !c.workspace,
              edit: (
                <Select
                  label="Clockify workspace"
                  value={c.workspace}
                  options={plain(workspaces)}
                  onChange={(workspace) => set("clockify", { workspace })}
                />
              ),
            },
          ]
        : []),
      {
        id: "quiet",
        label: "Quiet minutes",
        value: `${c.quiet} min after you last touch a project`,
        edit: (
          <input
            type="number"
            className="pl-inline-number"
            aria-label="Quiet minutes"
            min={1}
            max={120}
            value={c.quiet}
            onChange={(e) => set("clockify", { quiet: Number(e.target.value) })}
          />
        ),
      },
      ...(c.key && c.workspace
        ? [
            {
              id: "projects",
              label: "Projects",
              wide: true,
              missing: !tracked.length,
              value: tracked.length ? (
                <span className="pl-map-readout">
                  {tracked.map((p) => (
                    <span key={p.id}>
                      {p.name}
                      <span className="pl-arrow">→</span>
                      <ProjectDot id={c.projects[p.id]} />
                      {
                        clockifyProjects.find((x) => x.id === c.projects[p.id])
                          ?.name
                      }
                    </span>
                  ))}
                  <span className="pl-muted-line">
                    {relayProjects.length - tracked.length} more not tracked
                  </span>
                </span>
              ) : (
                "None tracked yet"
              ),
              edit: <ClockifyProjectList c={c} set={set} />,
            },
          ]
        : []),
    ];
  }
  const d = state.devops;
  return [
    {
      id: "org",
      label: "Organization",
      value: d.org || "Not set",
      missing: !d.org,
      edit: (
        <input
          className="pl-inline-text"
          aria-label="Azure DevOps organization"
          placeholder="your-org"
          value={d.org}
          onChange={(e) => set("devops", { org: e.target.value })}
        />
      ),
    },
    {
      id: "pat",
      label: "Token",
      value: d.pat ? "In keychain" : "Not connected",
      missing: !d.pat,
      edit: (
        <SettingsCard>
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
        </SettingsCard>
      ),
    },
    ...(d.pat
      ? [
          {
            id: "project",
            label: "Project",
            value: d.project || "Not picked",
            missing: !d.project,
            edit: (
              <Select
                label="Azure DevOps project"
                value={d.project}
                options={plain(devopsProjects)}
                onChange={(project) => set("devops", { project })}
              />
            ),
          },
        ]
      : []),
    {
      id: "mine",
      label: "Picker lists",
      value: d.mine ? "Items assigned to you" : "The whole board",
      edit: (
        <Select
          label="Picker lists"
          value={d.mine ? "mine" : "all"}
          options={[
            { value: "mine", label: "Items assigned to you" },
            { value: "all", label: "The whole board" },
          ]}
          onChange={(v) => set("devops", { mine: v === "mine" })}
        />
      ),
    },
    {
      id: "insert",
      label: "Inserts",
      value: d.insert === "link" ? "An AB# link" : "The item's title",
      edit: (
        <Select
          label="Inserts"
          value={d.insert}
          options={[
            { value: "link", label: "An AB# link" },
            { value: "title", label: "The item's title" },
          ]}
          onChange={(v) => set("devops", { insert: v as "link" | "title" })}
        />
      ),
    },
  ];
}

function ReadoutCard({
  id,
  state,
  set,
  savedAt,
}: OptionProps & { id: PluginId }) {
  const [open, setOpen] = useStored(`pl-readout-${id}`, true);
  const [editing, setEditing] = useState<string>();
  const list = facts(id, state, set);
  // Until you pick one, the first missing fact is the one open for editing.
  const current = editing ?? list.find((f) => f.missing)?.id;
  return (
    <section
      className={`pl-readout ${open ? "open" : ""}`}
      aria-label={meta[id].title}
    >
      <div className="pl-card-head">
        <button
          className="pl-head-button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <PluginIcon id={id} />
          <span className="pl-head-text">
            <strong>{meta[id].title}</strong>
            {!open && (
              <small className={needsSetup(id, state) ? "pl-attention" : ""}>
                {status(id, state)}
              </small>
            )}
          </span>
          <Chevron open={open} />
        </button>
        <SavedNote at={savedAt[id]} />
        <PluginToggle id={id} state={state} set={set} />
      </div>
      {open && (
        <dl className="pl-facts pl-reveal">
          {list.map((f) => {
            const isEditing = current === f.id;
            return (
              <div
                key={f.id}
                className={`pl-fact ${f.wide ? "wide" : ""} ${isEditing ? "editing" : ""}`}
              >
                <dt>{f.label}</dt>
                <dd>
                  {isEditing ? (
                    <div className="pl-fact-edit">
                      {f.edit}
                      <button
                        className="text-button"
                        onClick={() => setEditing("")}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <button
                      className={`pl-fact-value ${f.missing ? "pl-attention" : ""}`}
                      onClick={() => setEditing(f.id)}
                    >
                      <span>{f.value}</span>
                      <Pencil size={11} />
                    </button>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

export function Readout(props: OptionProps) {
  const on = pluginIds.filter((id) => props.state[id].on);
  const off = pluginIds.filter((id) => !props.state[id].on);
  return (
    <div className="pl-stack">
      {on.map((id) => (
        <ReadoutCard key={id} id={id} {...props} />
      ))}
      {!!off.length && (
        <div className="settings-group">
          <h5>Available</h5>
          <SettingsCard>
            {off.map((id) => (
              <SettingsRow
                key={id}
                label={
                  <span className="pl-available">
                    <PluginIcon id={id} size={24} />
                    {meta[id].title}
                  </span>
                }
                hint={meta[id].tagline}
              >
                <PluginToggle id={id} state={props.state} set={props.set} />
              </SettingsRow>
            ))}
          </SettingsCard>
        </div>
      )}
    </div>
  );
}
