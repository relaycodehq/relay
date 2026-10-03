import { useState, type ReactNode } from "react";
import type {
  ContextItem,
  ContextReport,
} from "../../../shared/context-report";
import { formatTokens } from "./tokens";
import "./context-breakdown.css";

// Each category keeps its colour whatever else the report holds; the slots
// run in the order Claude lists them, which keeps neighbours apart for
// colour-blind readers.
const slots: Record<string, number> = {
  "System prompt": 1,
  "System tools": 2,
  "MCP server instructions": 3,
  "MCP tools": 3,
  "Custom agents": 4,
  "Memory files": 5,
  Skills: 6,
  Messages: 7,
};
const colour = (name: string) =>
  slots[name] ? `var(--context-${slots[name]})` : "var(--muted)";

const share = (tokens: number, max: number) =>
  `${Math.min(100, (tokens / max) * 100)}%`;

/** The fuller of `items` first; the rest only as a count. */
function ItemList({
  items,
  label,
  limit = 5,
}: {
  items: { key: string; name: ReactNode; title?: string; tokens: number }[];
  label: string;
  limit?: number;
}) {
  const sorted = [...items].sort((a, b) => b.tokens - a.tokens);
  const rest = sorted.slice(limit);
  return (
    <ul className="context-items" aria-label={label}>
      {sorted.slice(0, limit).map((item) => (
        <li key={item.key} title={item.title}>
          <span>{item.name}</span>
          <span>{formatTokens(item.tokens)}</span>
        </li>
      ))}
      {!!rest.length && (
        <li className="context-items-rest">
          <span>{rest.length} more</span>
          <span>
            {formatTokens(rest.reduce((sum, i) => sum + i.tokens, 0))}
          </span>
        </li>
      )}
    </ul>
  );
}

function Section({
  title,
  count,
  tokens,
  children,
}: {
  title: string;
  count: number;
  tokens: number;
  children: ReactNode;
}) {
  return (
    <details className="context-section">
      <summary>
        <span>
          {title} <span className="muted">{count}</span>
        </span>
        <span>{formatTokens(tokens)}</span>
      </summary>
      {children}
    </details>
  );
}

const total = (items: ContextItem[]) =>
  items.reduce((sum, item) => sum + item.tokens, 0);

const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;

/** MCP tools add up per server; the tools are in the row's tooltip. */
function byServer(tools: ContextItem[]) {
  const servers = new Map<string, ContextItem[]>();
  for (const tool of tools) {
    const server = tool.source ?? "";
    servers.set(server, [...(servers.get(server) ?? []), tool]);
  }
  return [...servers].map(([server, list]) => ({
    key: server,
    name: (
      <>
        {server || "Other"}{" "}
        <span className="muted">
          {list.length} {list.length === 1 ? "tool" : "tools"}
        </span>
      </>
    ),
    title: list.map((t) => t.name.replace(`mcp__${server}__`, "")).join(", "),
    tokens: total(list),
  }));
}

/**
 * What fills the context window: a bar by category, then the files, tools,
 * skills and agents behind the larger ones.
 */
export function ContextBreakdown({
  report,
  title = "What's in it",
  note,
}: {
  report: ContextReport;
  title?: ReactNode;
  /** Beside the heading, e.g. when this was counted. */
  note?: ReactNode;
}) {
  const max = report.maxTokens;
  const used = report.categories.filter((c) => c.kind === "used");
  const buffer = report.categories.filter((c) => c.kind === "buffer");
  const free = report.categories.find((c) => c.kind === "free");
  const deferred = report.categories.filter((c) => c.kind === "deferred");
  const sections = [
    report.memoryFiles.length && (
      <Section
        key="memory"
        title="Memory files"
        count={report.memoryFiles.length}
        tokens={total(report.memoryFiles)}
      >
        <ItemList
          label="Memory files"
          items={report.memoryFiles.map((file) => ({
            key: file.name,
            name: (
              <>
                {fileName(file.name)}{" "}
                <span className="muted">{file.source}</span>
              </>
            ),
            title: file.name,
            tokens: file.tokens,
          }))}
        />
      </Section>
    ),
    report.mcpTools.length && (
      <Section
        key="mcp"
        title="MCP tools"
        count={report.mcpTools.length}
        tokens={total(report.mcpTools)}
      >
        <ItemList label="MCP servers" items={byServer(report.mcpTools)} />
      </Section>
    ),
    report.skills.length && (
      <Section
        key="skills"
        title="Skills"
        count={report.skills.length}
        tokens={total(report.skills)}
      >
        <ItemList
          label="Skills"
          items={report.skills.map((skill) => ({
            key: `${skill.source}:${skill.name}`,
            name: (
              <>
                {skill.name} <span className="muted">{skill.source}</span>
              </>
            ),
            tokens: skill.tokens,
          }))}
        />
      </Section>
    ),
    report.agents.length && (
      <Section
        key="agents"
        title="Custom agents"
        count={report.agents.length}
        tokens={total(report.agents)}
      >
        <ItemList
          label="Custom agents"
          items={report.agents.map((agent) => ({
            key: `${agent.source}:${agent.name}`,
            name: (
              <>
                {agent.name} <span className="muted">{agent.source}</span>
              </>
            ),
            tokens: agent.tokens,
          }))}
        />
      </Section>
    ),
  ].filter(Boolean);
  return (
    <div className="context-breakdown">
      <div className="usage-meter-top">
        <span>{title}</span>
        <span className="usage-limit">
          {note ?? `${formatTokens(report.totalTokens)} / ${formatTokens(max)}`}
        </span>
      </div>
      <div
        className="context-stack"
        role="img"
        aria-label={used
          .map((c) => `${c.name} ${formatTokens(c.tokens)}`)
          .join(", ")}
      >
        {used.map((c) => (
          <span
            key={c.name}
            style={{ width: share(c.tokens, max), background: colour(c.name) }}
            title={`${c.name} · ${formatTokens(c.tokens)}`}
          />
        ))}
        {buffer.map((c) => (
          <span
            key={c.name}
            className="context-stack-buffer"
            style={{ width: share(c.tokens, max) }}
            title={`${c.name} · ${formatTokens(c.tokens)}`}
          />
        ))}
        {!!report.compactsAt && report.compactsAt < max && (
          <i
            className="context-stack-mark"
            style={{ left: share(report.compactsAt, max) }}
            title={`Compacts at ${formatTokens(report.compactsAt)}`}
          />
        )}
      </div>
      <ul className="context-legend">
        {[...used, ...buffer, ...(free ? [free] : [])].map((c) => (
          <li key={c.name}>
            <i
              className={
                c.kind === "buffer"
                  ? "context-stack-buffer"
                  : c.kind === "free"
                    ? "context-legend-free"
                    : undefined
              }
              style={
                c.kind === "used" ? { background: colour(c.name) } : undefined
              }
            />
            <span>{c.name}</span>
            <span>{formatTokens(c.tokens)}</span>
          </li>
        ))}
      </ul>
      {!!deferred.length && (
        <p className="context-deferred">
          Loaded only when used:{" "}
          {deferred
            .map(
              (c) =>
                `${c.name.replace(/\s*\(deferred\)$/i, "")} ${formatTokens(c.tokens)}`,
            )
            .join(" · ")}
        </p>
      )}
      {!!sections.length && <div className="context-sections">{sections}</div>}
    </div>
  );
}

/** A `/context` answer as the breakdown, with Claude's own tables a click away. */
export function ContextReportCard({
  report,
  raw,
}: {
  report: ContextReport;
  /** The answer as Claude wrote it. */
  raw: ReactNode;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const percent = Math.round((report.totalTokens / report.maxTokens) * 100);
  return (
    <section
      className="context-report-card"
      aria-label="Context usage"
      data-raw={showRaw || undefined}
    >
      <header>
        <span>
          Context window <span className="muted">{report.model}</span>
        </span>
        <button
          type="button"
          className="context-report-raw"
          aria-pressed={showRaw}
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? "Show summary" : "Show raw"}
        </button>
      </header>
      {showRaw ? (
        raw
      ) : (
        <ContextBreakdown report={report} title={`${percent}% used`} />
      )}
    </section>
  );
}
