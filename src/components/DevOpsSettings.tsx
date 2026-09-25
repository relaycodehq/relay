import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  devopsSettingsSchema,
  type DevOpsSecrets,
  type DevOpsSettings as Settings,
} from "../../shared/devops";
import { api } from "../lib/api";
import { ErrorBox } from "./ui";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";
import "./work-items.css";

export const useDevOpsStatus = () =>
  useQuery({ queryKey: ["devops-status"], queryFn: () => api.devopsStatus() });

/** Each section drafts only its own part, so saving one keeps the other. */
function useDevOpsDraft<T>(
  pick: (s: Settings) => T,
  merge: (s: Settings, part: T) => Settings,
) {
  const status = useDevOpsStatus(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<T>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [note, setNote] = useState<string>();
  const saved = status.data?.settings;
  const values = draft ?? (saved && pick(saved));
  const full = saved && values !== undefined ? merge(saved, values) : undefined;
  const save = async (
    secrets: DevOpsSecrets,
    after?: (s: Settings) => Promise<string>,
  ) => {
    if (!full) return false;
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const next = await api.saveDevOpsSettings(full, secrets);
      qc.setQueryData(["devops-status"], next);
      setDraft(undefined);
      await qc.invalidateQueries({ queryKey: ["devops-items"] });
      setNote(after ? await after(next.settings) : "Saved");
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    values,
    change: (next: T) => {
      setDraft(next);
      setNote(undefined);
    },
    dirty: draft !== undefined,
    valid: !!full && devopsSettingsSchema.safeParse(full).success,
    busy,
    error,
    note,
    save,
  };
}

export function DevOpsConnectionSettings() {
  const d = useDevOpsDraft(
    ({ filter: _, hiddenProjects: __, ...connection }) => connection,
    (s, connection) => ({
      ...connection,
      filter: s.filter,
      hiddenProjects: s.hiddenProjects,
    }),
  );
  const [pat, setPat] = useState("");
  const v = d.values;
  if (!v)
    return d.status.error ? (
      <ErrorBox error={d.status.error} retry={() => void d.status.refetch()} />
    ) : (
      <p className="setting-muted">Loading…</p>
    );
  const hasPat = d.status.data?.hasPat;
  return (
    <>
      <SettingsCard>
        <SettingsRow label="Show my work items under new threads">
          <Switch
            label="Show my work items under new threads"
            checked={v.enabled}
            onChange={(enabled) => d.change({ ...v, enabled })}
          />
        </SettingsRow>
        <SettingsRow label="Organization" hint="Name or dev.azure.com URL.">
          <input
            aria-label="Organization"
            placeholder="my-org"
            value={v.organization}
            onChange={(e) => d.change({ ...v, organization: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow label="Project" hint="Leave empty for every project.">
          <input
            aria-label="Project"
            placeholder="All projects"
            value={v.project}
            onChange={(e) => d.change({ ...v, project: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Sign in with"
          hint={
            v.auth === "pat" ? (
              "A personal access token, saved with your system’s credential protection."
            ) : (
              <>
                The account you signed into with <code>az login</code>. Relay
                stores no token.
              </>
            )
          }
        >
          <div className="segmented settings-segmented">
            <button
              className={v.auth === "pat" ? "active" : ""}
              onClick={() => d.change({ ...v, auth: "pat" })}
            >
              Access token
            </button>
            <button
              className={v.auth === "azure-cli" ? "active" : ""}
              onClick={() => d.change({ ...v, auth: "azure-cli" })}
            >
              Azure CLI
            </button>
          </div>
        </SettingsRow>
        {v.auth === "pat" && (
          <SettingsRow
            label="Personal access token"
            hint={
              <>
                Needs the <strong>Work Items (Read)</strong> scope.
              </>
            }
          >
            <input
              aria-label="Personal access token"
              type="password"
              autoComplete="off"
              placeholder={hasPat ? "Saved · enter a new one to replace" : ""}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
            />
          </SettingsRow>
        )}
        <SettingsFooter note={d.note && <span role="status">{d.note}</span>}>
          {hasPat && v.auth === "pat" && (
            <button
              disabled={d.busy}
              onClick={() => void d.save({ pat: null })}
            >
              Forget token
            </button>
          )}
          <button
            className="primary"
            disabled={
              d.busy ||
              !d.valid ||
              (!d.dirty && !pat.trim() && !v.enabled) ||
              (v.enabled && !v.organization.trim())
            }
            onClick={() =>
              void d.save(pat.trim() ? { pat: pat.trim() } : {}, async (s) => {
                setPat("");
                if (!s.enabled) return "Saved";
                const { items } = await api.devopsWorkItems(null, true);
                return `Connected · ${items.length} open ${items.length === 1 ? "item" : "items"} assigned to you`;
              })
            }
          >
            {d.busy ? "Connecting…" : v.enabled ? "Save and test" : "Save"}
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!d.error && <ErrorBox error={d.error} />}
    </>
  );
}

export function DevOpsFilterSettings() {
  const d = useDevOpsDraft(
    ({ filter: { keywords: _, ...filter } }) => filter,
    (s, filter) => ({
      ...s,
      filter: { ...filter, keywords: s.filter.keywords },
    }),
  );
  const [key, setKey] = useState("");
  const f = d.values;
  if (!f) return <p className="setting-muted">Loading…</p>;
  const hasKey = d.status.data?.hasOpenRouterKey;
  const setFilter = (next: Partial<typeof f>) => d.change({ ...f, ...next });
  return (
    <>
      <SettingsCard>
        <SettingsRow
          label="Show only the items that belong to the open project"
          hint="Jev sorts your items by project on OpenRouter."
        >
          <Switch
            label="Show only the items that belong to the open project"
            checked={f.enabled}
            onChange={(enabled) => setFilter({ enabled })}
          />
        </SettingsRow>
        <SettingsRow
          label="OpenRouter API key"
          hint="Saved with your system’s credential protection."
        >
          <input
            aria-label="OpenRouter API key"
            type="password"
            autoComplete="off"
            placeholder={
              hasKey ? "Saved · enter a new one to replace" : "sk-or-…"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow label="Model" hint="OpenRouter model ID.">
          <input
            aria-label="Model"
            value={f.model}
            onChange={(e) => setFilter({ model: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Confidence"
          hint="How sure Jev must be before an item counts as a match."
        >
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
          <span className="settings-row-value">
            {Math.round(f.threshold * 100)}%
          </span>
        </SettingsRow>
        <SettingsFooter
          note={
            d.note ? (
              <span role="status">{d.note}</span>
            ) : (
              "Sends work item titles, types, area paths, tags and the start of descriptions to OpenRouter. Answers are reused until an item changes."
            )
          }
        >
          {hasKey && (
            <button
              disabled={d.busy}
              onClick={() => void d.save({ openRouterKey: null })}
            >
              Forget key
            </button>
          )}
          <button
            className="primary"
            disabled={d.busy || !d.valid || (!d.dirty && !key.trim())}
            onClick={() =>
              void d
                .save(key.trim() ? { openRouterKey: key.trim() } : {})
                .then((ok) => ok && setKey(""))
            }
          >
            {d.busy ? "Saving…" : "Save filter"}
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!d.error && <ErrorBox error={d.error} />}
    </>
  );
}

/** Which projects show work item cards, and the filter's hints for each. */
export function DevOpsProjectSettings() {
  const d = useDevOpsDraft(
    (s) => ({ hidden: s.hiddenProjects, keywords: s.filter.keywords }),
    (s, { hidden, keywords }) => ({
      ...s,
      hiddenProjects: hidden,
      filter: { ...s.filter, keywords },
    }),
  );
  const projects = useQuery({
    queryKey: ["devops-projects"],
    queryFn: async () => (await api.projects()).filter((p) => !p.scratch),
  });
  const v = d.values;
  if (!v || !projects.data) return <p className="setting-muted">Loading…</p>;
  if (!projects.data.length)
    return <p className="setting-muted">Add a project to choose here.</p>;
  const filtering = !!d.status.data?.settings.filter.enabled;
  return (
    <>
      <SettingsCard>
        {projects.data.map((p) => {
          const shown = !v.hidden.includes(p.id);
          return (
            <SettingsRow
              key={p.id}
              label={p.name}
              hint={shown ? undefined : "Work items are hidden here."}
            >
              {filtering && shown && (
                <input
                  aria-label={`${p.name} hints`}
                  placeholder="Hints, e.g. Licensing, BM"
                  title="Product names, area paths, tags or abbreviations. Jev also sees project and repository names."
                  value={v.keywords[p.id] ?? ""}
                  onChange={(e) => {
                    const keywords = { ...v.keywords, [p.id]: e.target.value };
                    if (!e.target.value) delete keywords[p.id];
                    d.change({ ...v, keywords });
                  }}
                />
              )}
              <Switch
                label={`Show work items in ${p.name}`}
                checked={shown}
                onChange={(on) =>
                  d.change({
                    ...v,
                    hidden: on
                      ? v.hidden.filter((id) => id !== p.id)
                      : [...v.hidden, p.id],
                  })
                }
              />
            </SettingsRow>
          );
        })}
        <SettingsFooter
          note={
            d.note ? (
              <span role="status">{d.note}</span>
            ) : filtering ? (
              "Hints help Jev match work items to each project."
            ) : undefined
          }
        >
          <button
            className="primary"
            disabled={d.busy || !d.valid || !d.dirty}
            onClick={() => void d.save({})}
          >
            {d.busy ? "Saving…" : "Save projects"}
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!d.error && <ErrorBox error={d.error} />}
    </>
  );
}
