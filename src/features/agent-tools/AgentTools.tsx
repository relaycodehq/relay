import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FileText,
  Info,
  Monitor,
  FolderGit2,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { agentName, type AgentProvider } from "../../../shared/agents";
import {
  agentToolSources,
  agentToolStates,
  type AgentTool,
  type AgentToolSource,
  type AgentToolState,
} from "../../../shared/agent-tools";
import { api } from "../../lib/api";
import { Segmented, SettingsCard } from "../../ui/SettingsCard";
import { ErrorBox, Spinner } from "../../ui/ui";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useRunnableAgents } from "../agents/registry-agents";
import { useAgentAccounts } from "../accounts/agent-accounts";
import { filterAgentTools } from "./filter";
import "./agent-tools.css";

function ToolRow({ tool }: { tool: AgentTool }) {
  return (
    <details className="agent-tool-item" data-state={tool.state}>
      <summary>
        <span className="agent-tool-glyph">
          {tool.transport ? <Plug size={17} /> : <FileText size={17} />}
        </span>
        <span className="agent-tool-copy">
          <span className="agent-tool-name">
            {tool.name}
            {tool.transport && <small>{tool.transport}</small>}
          </span>
          <span className="agent-tool-description">{tool.description}</span>
        </span>
        <span className={`agent-tool-status ${tool.state}`}>
          <i />
          {agentToolStates[tool.state]}
        </span>
        <ChevronRight className="agent-tool-chevron" size={15} />
      </summary>
      <div className="agent-tool-details">
        {tool.detail && <p>{tool.detail}</p>}
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{agentToolSources.find((s) => s.id === tool.source)?.label}</dd>
          </div>
          <div>
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
          </div>
          {tool.summary && (
            <div>
              <dt>
                {tool.transport === "stdio" ? "Executable" : "Endpoint origin"}
              </dt>
              <dd>
                <code>{tool.summary}</code>
              </dd>
            </div>
          )}
        </dl>
        <span className="agent-tools-read-only">
          <ShieldCheck size={13} />
          Inspection only · configuration stays with its owner
        </span>
      </div>
    </details>
  );
}

/** Settings → AI & agents → Agent tools. Shows configuration for new sessions. */
export function AgentTools({
  initialProjectId,
}: {
  initialProjectId?: string;
}) {
  const runnable = useRunnableAgents();
  const accounts = useAgentAccounts();
  const [agent, setAgent] = useState<AgentProvider>("codex");
  const [computer, setComputer] = useState("");
  const [selectedProject, setSelectedProject] = useState<string>();
  const [tab, setTab] = useState<"skills" | "servers">("skills");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<AgentToolSource | "all">("all");
  const [state, setState] = useState<AgentToolState | "all">("all");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects(),
  });
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
  const account =
    !computer && (agent === "codex" || agent === "claude")
      ? accounts?.inUse[agent]
      : undefined;
  const inventory = useQuery({
    queryKey: ["agent-tools", computer, projectId, agent, account],
    queryFn: () =>
      api.agentTools(projectId || null, agent, computer || undefined),
    enabled: projects.isSuccess,
    staleTime: 0,
    retry: false,
  });
  const listing = !inventory.isError ? inventory.data?.[tab] : undefined;
  const items = listing?.items ?? [];
  const filtered = filterAgentTools(items, query, source, state);
  const computerName = computer
    ? (computers.data?.find((c) => c.id === computer)?.name ??
      "the selected computer")
    : "this computer";
  const changeTab = (value: "skills" | "servers") => {
    setTab(value);
    setQuery("");
    setSource("all");
    setState("all");
  };
  const refresh = () => {
    void inventory.refetch();
  };
  return (
    <div className="agent-tools">
      <div className="agent-tools-context">
        <label>
          <span>Computer</span>
          <span className="agent-tools-select">
            <Monitor size={14} />
            <select
              aria-label="Tools computer"
              value={computer}
              onChange={(e) => setComputer(e.target.value)}
            >
              <option value="">This computer</option>
              {computers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.status !== "online" ? " · Offline" : ""}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label>
          <span>Project</span>
          <span className="agent-tools-select">
            <FolderGit2 size={14} />
            <select
              aria-label="Tools project"
              value={projectId}
              onChange={(e) => setSelectedProject(e.target.value)}
              disabled={projects.isPending}
            >
              <option value="">Personal configuration</option>
              {offeredProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label>
          <span>Agent</span>
          <span className="agent-tools-select">
            <ProviderIcon provider={agent} />
            <select
              aria-label="Tools agent"
              value={agent}
              onChange={(e) => setAgent(e.target.value as AgentProvider)}
            >
              {runnable.map((p) => (
                <option key={p} value={p}>
                  {agentName(p)}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <p className="agent-tools-scope">
        <Info size={14} />
        <span>
          {projectId
            ? "Configuration for the selected project's checkout"
            : "Personal configuration without a project selected"}{" "}
          on {computerName}.
          {inventory.data?.account && !inventory.isError
            ? ` Account: ${inventory.data.account}.`
            : ""}{" "}
          Running threads keep the tools their session loaded.
        </span>
      </p>
      {projects.isError && (
        <ErrorBox
          error={projects.error}
          retry={() => void projects.refetch()}
        />
      )}
      {computers.isError && (
        <div className="agent-tools-notice">
          <Info size={14} />
          <span>
            Paired computers could not be listed.{" "}
            <button
              className="text-button"
              onClick={() => void computers.refetch()}
            >
              Try again
            </button>
          </span>
        </div>
      )}
      <div className="agent-tools-tabs">
        <Segmented
          label="Tool type"
          value={tab}
          onChange={changeTab}
          options={[
            [
              "skills",
              `Skills${inventory.data && !inventory.isError ? ` (${inventory.data.skills.items.length})` : ""}`,
            ],
            [
              "servers",
              `MCP servers${inventory.data && !inventory.isError ? ` (${inventory.data.servers.items.length})` : ""}`,
            ],
          ]}
        />
        <button
          className="agent-tools-refresh"
          disabled={inventory.isFetching || projects.isPending}
          onClick={refresh}
        >
          {inventory.isFetching ? (
            <Spinner size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
          <span>{inventory.isFetching ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>
      <div className="agent-tools-intro">
        <div>
          <h4>{tab === "skills" ? "Skills" : "MCP servers"}</h4>
          <p>
            {tab === "skills"
              ? "Instructions your agent can use, grouped by where they come from."
              : "External tools configured for this agent, plus Relay's own tools."}
          </p>
        </div>
        {listing && (
          <span>
            {items.filter((t) => t.state === "enabled").length} enabled ·{" "}
            {items.filter((t) => t.state === "disabled").length} disabled
            {items.some((t) => t.state === "unknown") &&
              ` · ${items.filter((t) => t.state === "unknown").length} unknown`}
          </span>
        )}
      </div>
      <div className="agent-tools-filters">
        <label className="agent-tools-search">
          <Search size={14} />
          <input
            aria-label="Search agent tools"
            placeholder={tab === "skills" ? "Find a skill…" : "Find a server…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear tool search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
        <select
          aria-label="Tool source"
          value={source}
          onChange={(e) => setSource(e.target.value as AgentToolSource | "all")}
        >
          <option value="all">All sources</option>
          {agentToolSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Tool status"
          value={state}
          onChange={(e) => setState(e.target.value as AgentToolState | "all")}
        >
          <option value="all">All statuses</option>
          {Object.entries(agentToolStates).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {inventory.isError && (
        <ErrorBox error={inventory.error} retry={refresh} />
      )}
      {listing?.error && <ErrorBox error={listing.error} retry={refresh} />}
      {listing?.note && (
        <p className="agent-tools-notice">
          <Info size={14} />
          <span>{listing.note}</span>
        </p>
      )}
      <div
        key={`${computer}-${projectId}-${agent}-${tab}-${inventory.dataUpdatedAt}`}
        aria-busy={inventory.isFetching}
      >
        {inventory.isPending && !projects.isError ? (
          <p className="agent-tools-loading" role="status">
            Reading agent configuration…
          </p>
        ) : (
          agentToolSources.map((s) => {
            const rows = filtered.filter((t) => t.source === s.id);
            return rows.length ? (
              <section className="agent-tools-source" key={s.id}>
                <h5>
                  {s.label}
                  <span>{rows.length}</span>
                </h5>
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
            <Search size={21} />
            <h4>
              {items.length
                ? "No matching tools"
                : tab === "skills"
                  ? "No skills reported"
                  : "No servers reported"}
            </h4>
            <p>
              {items.length
                ? "Try another search or show all sources and statuses."
                : "Check the inventory notes above for this agent's discovery support."}
            </p>
            {items.length > 0 && (
              <button
                onClick={() => {
                  setQuery("");
                  setSource("all");
                  setState("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      {listing && (
        <footer className="agent-tools-footer">
          <span role="status">
            Read at{" "}
            {new Date(inventory.data!.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · configuration only
          </span>
          <span>
            {filtered.length} of {items.length} shown
          </span>
        </footer>
      )}
      <div className="agent-tools-readonly-note">
        <ShieldCheck size={15} />
        <p>
          Enabled means configured to load; it does not confirm a live
          connection. This page does not change your agent's settings.
        </p>
      </div>
    </div>
  );
}
