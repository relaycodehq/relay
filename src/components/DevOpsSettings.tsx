import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  devopsSettingsSchema,
  type DevOpsSecrets,
  type DevOpsSettings as Settings,
  type DevOpsStatus,
} from "../../shared/devops";
import { api } from "../lib/api";
import { Switch } from "./SettingsCard";
import { ErrorBox } from "./ui";
import "./work-items.css";

export const useDevOpsStatus = () =>
  useQuery({ queryKey: ["devops-status"], queryFn: () => api.devopsStatus() });

type Change = (next: Partial<Settings>) => void;

/**
 * Azure DevOps' details under Settings → Integrations → Source control, one
 * form with one save: the connection, which projects show work items, and
 * the filter that sorts them by project. The row's switch turns work items on
 * and off; setting it up the first time turns them on.
 */
export function AzureDevOpsDetails({
  cliField,
  onSaved,
}: {
  /** Where `az` is, shown while it signs in with the Azure CLI. */
  cliField: ReactNode;
  /** After a save, so the row says who it's signed in as now. */
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const status = useDevOpsStatus();
  // Only what was edited, laid over the saved settings when it's saved: the
  // row's switch or a card's "hide" may change the rest meanwhile.
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [pat, setPat] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [note, setNote] = useState<string>();
  const saved = status.data;
  if (!saved)
    return status.error ? (
      <ErrorBox error={status.error} retry={() => void status.refetch()} />
    ) : (
      <p className="setting-muted">Loading…</p>
    );
  const firstTime = !saved.settings.organization;
  const values = { ...saved.settings, ...draft };
  const change: Change = (next) => {
    setDraft({ ...draft, ...next });
    setNote(undefined);
  };
  const on = firstTime || saved.settings.enabled;
  const dirty = Object.keys(draft).length > 0;
  /** Saves the edits and new secrets, or, given `forgotten`, only drops a secret. */
  async function save(secrets: DevOpsSecrets, forgotten?: string) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const latest = qc.getQueryData<DevOpsStatus>(["devops-status"])!;
      const next = await api.saveDevOpsSettings(
        forgotten
          ? latest.settings
          : {
              ...latest.settings,
              ...draft,
              enabled: firstTime || latest.settings.enabled,
            },
        secrets,
      );
      qc.setQueryData(["devops-status"], next);
      await qc.invalidateQueries({ queryKey: ["devops-items"] });
      onSaved();
      if (forgotten) {
        setNote(`${forgotten} forgotten`);
        return;
      }
      setDraft({});
      if (secrets.pat) setPat("");
      if (secrets.openRouterKey) setOpenRouterKey("");
      if (!next.settings.enabled) setNote("Saved");
      else {
        const { items } = await api.devopsWorkItems(null, true);
        setNote(
          `Connected · ${items.length} open ${items.length === 1 ? "item" : "items"} assigned to you`,
        );
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const secrets: DevOpsSecrets = {
    ...(pat.trim() ? { pat: pat.trim() } : {}),
    ...(openRouterKey.trim() ? { openRouterKey: openRouterKey.trim() } : {}),
  };
  const forget = (secret: keyof DevOpsSecrets, what: string) => (
    <button
      className="text-button"
      disabled={busy}
      onClick={() => void save({ [secret]: null }, what)}
    >
      Forget
    </button>
  );
  return (
    <>
      <Connection
        values={values}
        change={change}
        status={saved}
        pat={pat}
        setPat={setPat}
        forgetPat={forget("pat", "Token")}
        cliField={cliField}
      />
      {!firstTime && (
        <>
          <Filter
            values={values}
            change={change}
            hasKey={saved.hasOpenRouterKey}
            openRouterKey={openRouterKey}
            setOpenRouterKey={setOpenRouterKey}
            forgetKey={forget("openRouterKey", "Key")}
          />
          <Projects values={values} change={change} />
        </>
      )}
      <hr />
      <div className="tool-row-actions">
        <p>{note && <span role="status">{note}</span>}</p>
        <button
          className="primary"
          disabled={
            busy ||
            !devopsSettingsSchema.safeParse(values).success ||
            !values.organization.trim() ||
            (!dirty && !Object.keys(secrets).length && !on)
          }
          onClick={() => void save(secrets)}
        >
          {busy ? "Saving…" : on ? "Save and test" : "Save"}
        </button>
      </div>
      {!!error && <ErrorBox error={error} />}
    </>
  );
}

function Connection({
  values: v,
  change,
  status,
  pat,
  setPat,
  forgetPat,
  cliField,
}: {
  values: Settings;
  change: Change;
  status: DevOpsStatus;
  pat: string;
  setPat: (pat: string) => void;
  forgetPat: ReactNode;
  cliField: ReactNode;
}) {
  return (
    <>
      <div className="tool-row-fields">
        <div className="tool-row-field">
          <label>
            Organization
            <input
              placeholder="my-org"
              value={v.organization}
              onChange={(e) => change({ organization: e.target.value })}
            />
          </label>
          <small>Name or dev.azure.com URL.</small>
        </div>
        <div className="tool-row-field">
          <label>
            Project
            <input
              placeholder="All projects"
              value={v.project}
              onChange={(e) => change({ project: e.target.value })}
            />
          </label>
          <small>Leave empty for every project.</small>
        </div>
        <div
          className="tool-row-wide tool-row-choice"
          role="group"
          aria-label="Sign in with"
        >
          <span>Sign in with</span>
          <div className="segmented settings-segmented">
            <button
              className={v.auth === "pat" ? "active" : ""}
              aria-pressed={v.auth === "pat"}
              onClick={() => change({ auth: "pat" })}
            >
              Access token
            </button>
            <button
              className={v.auth === "azure-cli" ? "active" : ""}
              aria-pressed={v.auth === "azure-cli"}
              onClick={() => change({ auth: "azure-cli" })}
            >
              Azure CLI
            </button>
          </div>
        </div>
        {v.auth === "pat" && (
          <div className="tool-row-field tool-row-wide">
            <label>
              Personal access token
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  status.hasPat ? "Saved · enter a new one to replace" : ""
                }
                value={pat}
                onChange={(e) => setPat(e.target.value)}
              />
            </label>
            <small>
              Needs the Work Items (Read) scope. Saved with your system’s
              credential protection. {status.hasPat && forgetPat}
            </small>
          </div>
        )}
      </div>
      {v.auth === "azure-cli" && (
        <>
          {cliField}
          <p className="tool-row-off">
            Uses the account you signed into with <code>az login</code>. Relay
            stores no token.
          </p>
        </>
      )}
    </>
  );
}

/** Jev on OpenRouter, deciding which work items belong to the open project. */
function Filter({
  values: v,
  change,
  hasKey,
  openRouterKey,
  setOpenRouterKey,
  forgetKey,
}: {
  values: Settings;
  change: Change;
  hasKey: boolean;
  openRouterKey: string;
  setOpenRouterKey: (key: string) => void;
  forgetKey: ReactNode;
}) {
  const f = v.filter;
  const setFilter = (next: Partial<Settings["filter"]>) =>
    change({ filter: { ...f, ...next } });
  return (
    <section className="tool-row-group" aria-label="Work item filter">
      <div className="tool-row-group-head">
        <div>
          <h6>Only the open project's items</h6>
          <small>
            Jev, a decision model on OpenRouter, decides which work items belong
            to the project you are in.
          </small>
        </div>
        <Switch
          label="Show only the items that belong to the open project"
          checked={f.enabled}
          onChange={(enabled) => setFilter({ enabled })}
        />
      </div>
      {f.enabled && (
        <div className="tool-row-fields">
          <div className="tool-row-field tool-row-wide">
            <label>
              OpenRouter API key
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  hasKey ? "Saved · enter a new one to replace" : "sk-or-…"
                }
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
              />
            </label>
            <small>
              Saved with your system’s credential protection.{" "}
              {hasKey && forgetKey}
            </small>
          </div>
          <div className="tool-row-field">
            <label>
              Model
              <input
                value={f.model}
                onChange={(e) => setFilter({ model: e.target.value })}
              />
            </label>
            <small>OpenRouter model ID.</small>
          </div>
          <div className="tool-row-field">
            <label>
              Confidence · {Math.round(f.threshold * 100)}%
              <input
                aria-label="Match confidence"
                type="range"
                min={5}
                max={95}
                step={5}
                value={Math.round(f.threshold * 100)}
                onChange={(e) =>
                  setFilter({ threshold: Number(e.target.value) / 100 })
                }
              />
            </label>
            <small>How sure Jev must be before an item counts.</small>
          </div>
          <small className="tool-row-wide">
            Sends work item titles, types, area paths, tags and the start of
            descriptions to OpenRouter. Answers are reused until an item
            changes.
          </small>
        </div>
      )}
    </section>
  );
}

/** Which projects show work item cards, and the filter's hints for each. */
function Projects({ values: v, change }: { values: Settings; change: Change }) {
  const projects = useQuery({
    queryKey: ["devops-projects"],
    queryFn: async () => (await api.projects()).filter((p) => !p.scratch),
  });
  const filtering = v.filter.enabled;
  return (
    <section className="tool-row-group" aria-label="Work items per project">
      <div className="tool-row-group-head">
        <div>
          <h6>Projects</h6>
          <small>
            {filtering
              ? "Turn work items off where a project isn't tracked in Azure DevOps. Hints help Jev match items to the rest."
              : "Turn work items off where a project isn't tracked in Azure DevOps."}
          </small>
        </div>
      </div>
      {!projects.data ? (
        <p className="setting-muted">Loading…</p>
      ) : !projects.data.length ? (
        <p className="setting-muted">Add a project to choose here.</p>
      ) : (
        <div className="tool-row-list">
          {projects.data.map((p) => {
            const shown = !v.hiddenProjects.includes(p.id);
            return (
              <div key={p.id} className="tool-row-item">
                <span data-hidden={!shown || undefined}>{p.name}</span>
                {filtering && shown && (
                  <input
                    aria-label={`${p.name} hints`}
                    placeholder="Hints, e.g. Licensing, BM"
                    title="Product names, area paths, tags or abbreviations. Jev also sees project and repository names."
                    value={v.filter.keywords[p.id] ?? ""}
                    onChange={(e) => {
                      const keywords = {
                        ...v.filter.keywords,
                        [p.id]: e.target.value,
                      };
                      if (!e.target.value) delete keywords[p.id];
                      change({ filter: { ...v.filter, keywords } });
                    }}
                  />
                )}
                <Switch
                  label={`Show work items in ${p.name}`}
                  checked={shown}
                  onChange={(on) =>
                    change({
                      hiddenProjects: on
                        ? v.hiddenProjects.filter((id) => id !== p.id)
                        : [...v.hiddenProjects, p.id],
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
