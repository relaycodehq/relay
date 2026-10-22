import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FolderGit2,
  Info,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { agentName, type AgentProvider } from "../../../shared/agents";
import {
  agentToolSources,
  agentToolStates,
  type AgentTool,
  type AgentToolState,
} from "../../../shared/agent-tools";
import { api } from "../../lib/api";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { SettingsCard, SettingsSelect } from "../../ui/SettingsCard";
import { ErrorBox, Spinner } from "../../ui/ui";
import { useAgentAccounts } from "../accounts/agent-accounts";
import { computerLine } from "../handoff/computer-status";
import { filterAgentTools } from "./filter";
import "./agent-tools.css";
import { useProjectList } from "../../lib/workspace-queries";

type Tab = "skills" | "servers";

function ToolRow({ tool }: { tool: AgentTool }) {
  // A server's own description is just its transport, so its endpoint says more.
  const subtitle = tool.summary ?? tool.description;
  return (
    <details className="agent-tool-item" data-state={tool.state}>
      <summary>
        <span className="agent-tool-copy">
          <span className="agent-tool-name">
            {tool.name}
            {tool.transport && <small>{tool.transport}</small>}
          </span>
          <span
            className={`agent-tool-description${tool.summary ? " mono" : ""}`}
          >
            {subtitle}
          </span>
        </span>
        {tool.state !== "enabled" && (
          <span className={`agent-tool-status ${tool.state}`}>
            {agentToolStates[tool.state]}
          </span>
        )}
        <ChevronRight className="agent-tool-chevron" size={14} />
      </summary>
      <div className="agent-tool-details">
        {tool.detail && <p>{tool.detail}</p>}
        <dl>
          <dt>Loaded from</dt>
          <dd>
            {tool.path ? (
              <code>{tool.path}</code>
            ) : tool.source === "builtin" ? (
              "Provided by Relay"
            ) : (
              "Not reported by the agent"
            )}
          </dd>
        </dl>
      </div>
    </details>
  );
}

/**
 * The skills and MCP servers an agent's new sessions load, under its detail
 * in Settings → AI & agents → Agents. Read-only.
 */
export function AgentTools({
  agent,
  initialProjectId,
}: {
  agent: AgentProvider;
  initialProjectId?: string;
}) {
  const accounts = useAgentAccounts();
  const [computer, setComputer] = useState("");
  const [selectedProject, setSelectedProject] = useState<string>();
  const [tab, setTab] = useState<Tab>("skills");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<AgentToolState | "all">("all");
  const projects = useProjectList();
  const computers = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    retry: false,
  });
  const offeredProjects =
    projects.data?.filter((p) => !p.scratch && !p.removed) ?? [];
  const requestedProject =
    selectedProject ?? initialProjectId ?? offeredProjects[0]?.id ?? "";
  const projectId = offeredProjects.some((p) => p.id === requestedProject)
    ? requestedProject
    : "";
  const signsIn = !computer && (agent === "codex" || agent === "claude");
  const account = signsIn ? accounts?.inUse[agent] : undefined;
  const inventory = useQuery({
    queryKey: ["agent-tools", computer, projectId, agent, account],
    queryFn: () =>
      api.agentTools(projectId || null, agent, computer || undefined),
    // Waits for what picks the agent and its account, so the first answer isn't thrown away.
    enabled: projects.isSuccess && (!signsIn || accounts !== undefined),
    staleTime: 0,
    retry: false,
  });
  const data = !inventory.isError ? inventory.data : undefined;
  const listing = data?.[tab];
  const items = listing?.items ?? [];
  const filtered = filterAgentTools(items, query, state);
  const computerName = computer
    ? (computers.data?.find((c) => c.id === computer)?.name ??
      "the selected computer")
    : "this computer";
  const projectName = offeredProjects.find((p) => p.id === projectId)?.name;
  const counts = (["enabled", "disabled", "unknown"] as const).map(
    (s) => [s, items.filter((t) => t.state === s).length] as const,
  );
  const changeTab = (value: Tab) => {
    setTab(value);
    setQuery("");
    setState("all");
  };
  const refresh = () => {
    void inventory.refetch();
  };
  return (
    <div className="agent-tools">
      <div className="agent-tools-scope">
        <div className="composer-tools model-field">
          <ComposerSelect
            label="Tools computer"
            value={computer}
            icon={<Monitor size={14} />}
            onChange={setComputer}
            options={[
              { value: "", label: "This computer" },
              ...(computers.data ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                description:
                  c.status === "online"
                    ? undefined
                    : c.asleep || c.stopped
                      ? computerLine(c)
                      : "Offline",
              })),
            ]}
          />
          <span className="composer-divider" />
          <ComposerSelect
            label="Tools project"
            value={projectId}
            icon={projectId ? <FolderGit2 size={14} /> : <User size={14} />}
            onChange={setSelectedProject}
            options={[
              ...offeredProjects.map((p) => ({ value: p.id, label: p.name })),
              { value: "", label: "Personal configuration", short: "Personal" },
            ]}
          />
        </div>
        <button
          className="agent-tools-refresh"
          aria-label="Refresh"
          title="Read the configuration again"
          disabled={inventory.isFetching || projects.isPending}
          onClick={refresh}
        >
          {inventory.isFetching ? (
            <Spinner size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
        </button>
      </div>
      <p className="agent-tools-where">
        {projectName
          ? `${projectName}'s checkout on ${computerName}`
          : `Personal configuration on ${computerName}`}
        {data?.account && ` · ${data.account} account`}
        {data &&
          ` · read at ${new Date(data.checkedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`}
      </p>
      {projects.isError && (
        <ErrorBox
          error={projects.error}
          retry={() => void projects.refetch()}
        />
      )}
      {computers.isError && (
        <p className="agent-tools-notice">
          <Info size={13} />
          <span>
            Paired computers could not be listed.{" "}
            <button
              className="text-button"
              onClick={() => void computers.refetch()}
            >
              Try again
            </button>
          </span>
        </p>
      )}
      <div className="agent-tools-toolbar">
        <div
          className="segmented settings-segmented agent-tools-tabs"
          role="group"
          aria-label="Tool type"
        >
          {(
            [
              ["skills", "Skills"],
              ["servers", "MCP servers"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              aria-pressed={tab === id}
              onClick={() => changeTab(id)}
            >
              {label}
              {data && <span>{data[id].items.length}</span>}
            </button>
          ))}
        </div>
        <label className="agent-tools-search">
          <Search size={13} />
          <input
            aria-label="Search agent tools"
            placeholder={tab === "skills" ? "Find a skill" : "Find a server"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear tool search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
        <SettingsSelect<AgentToolState | "all">
          field="agent-tools-state"
          label="Tool status"
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: "Any status" },
            ...counts.map(([id, n]) => ({
              value: id,
              label: agentToolStates[id],
              short: `${agentToolStates[id]} ${n}`,
              description: listing
                ? `${n} ${n === 1 ? "tool" : "tools"}`
                : undefined,
            })),
          ]}
        />
      </div>
      {inventory.isError && (
        <ErrorBox error={inventory.error} retry={refresh} />
      )}
      {listing?.error && <ErrorBox error={listing.error} retry={refresh} />}
      {listing?.note && (
        <p className="agent-tools-notice">
          <Info size={13} />
          <span>{listing.note}</span>
        </p>
      )}
      <div
        key={`${computer}-${projectId}-${agent}-${tab}-${inventory.dataUpdatedAt}`}
        className="agent-tools-list"
        aria-busy={inventory.isFetching}
      >
        {inventory.isPending && !projects.isError ? (
          <p className="agent-tools-loading" role="status">
            <Spinner size={13} /> Reading {agentName(agent)}'s configuration…
          </p>
        ) : (
          agentToolSources.map((s) => {
            const rows = filtered.filter((t) => t.source === s.id);
            return rows.length ? (
              <section className="agent-tools-source" key={s.id}>
                <h4 className="settings-card-title">
                  {s.label}
                  <span>{rows.length}</span>
                </h4>
                <SettingsCard>
                  {rows.map((t) => (
                    <ToolRow key={t.id} tool={t} />
                  ))}
                </SettingsCard>
              </section>
            ) : null;
          })
        )}
        {listing && !filtered.length && !listing.error && (
          <div className="agent-tools-empty">
            <h4>
              {items.length
                ? "No matching tools"
                : tab === "skills"
                  ? "No skills reported"
                  : "No servers reported"}
            </h4>
            <p>
              {items.length
                ? "Nothing here matches that search and status."
                : `${agentName(agent)} didn't report any for this ${projectId ? "project" : "configuration"}.`}
            </p>
            {items.length > 0 && (
              <button
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setState("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      <p className="agent-tools-footnote">
        <ShieldCheck size={13} />
        <span>
          Read-only. Enabled means configured to load, not that it connects.
          Running threads keep what their session started with.
        </span>
      </p>
    </div>
  );
}
