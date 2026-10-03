// What fills an agent's context window, by category and by item: Claude
// Code's /context report, counted live or read back from its markdown.
import type { ChatMessage } from "./projects";

/** 'used' fills the window, 'free' is what's left, 'buffer' is kept back for compaction, 'deferred' tools load only when asked for. */
export type ContextCategoryKind = "used" | "free" | "buffer" | "deferred";

export type ContextItem = { name: string; tokens: number; source?: string };

export type ContextReport = {
  model: string;
  totalTokens: number;
  /** The window the report measures against. */
  maxTokens: number;
  /** Where autocompact kicks in, when the source says. */
  compactsAt?: number;
  categories: { name: string; tokens: number; kind: ContextCategoryKind }[];
  memoryFiles: ContextItem[];
  mcpTools: ContextItem[];
  agents: ContextItem[];
  skills: ContextItem[];
};

/** The kind Claude reports, or the one its markdown implies by the row's name. */
export function categoryKind(
  name: string,
  kind?: string,
  deferred?: boolean,
): ContextCategoryKind {
  if (kind === "used" || kind === "free" || kind === "buffer") return kind;
  if (kind === "deferred" || deferred) return "deferred";
  if (name === "Free space") return "free";
  if (name === "Autocompact buffer") return "buffer";
  return /\(deferred\)$/i.test(name) ? "deferred" : "used";
}

/** Claude Code's labels for where an agent or skill comes from. */
export function contextSourceLabel(source: string) {
  const labels: Record<string, string> = {
    userSettings: "User",
    projectSettings: "Project",
    localSettings: "Local",
    flagSettings: "Flag",
    policySettings: "Managed",
    plugin: "Plugin",
    "built-in": "Built-in",
    mcp: "MCP",
    memoryStore: "Memory store",
    syncedSkills: "claude.ai sync",
  };
  return labels[source] ?? source;
}

/** "23.5k", "1.2M", "560", "~100" and "< 20" as Claude Code prints them. */
export function parseTokenCount(text: string): number | null {
  const match = /^(?:~|<)?\s*([\d,.]+)\s*([kKmM])?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  return Math.round(
    value * (unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1),
  );
}

function tableRows(lines: string[]) {
  return lines
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
    .slice(1)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(" | ")
        .map((cell) => cell.trim()),
    );
}

/**
 * Reads the markdown `/context` answers with. Null for anything else, or a
 * shape this version doesn't know, so the answer shows as written.
 */
export function parseContextReport(markdown: string): ContextReport | null {
  if (!markdown.trimStart().startsWith("## Context Usage")) return null;
  const text = markdown.replace(/\r\n/g, "\n").trim();
  const model = /^\*\*Model:\*\*\s*(.+?)\s*$/m.exec(text)?.[1] ?? "";
  const totals = /^\*\*Tokens:\*\*\s*(\S+)\s*\/\s*(\S+)/m.exec(text);
  const totalTokens = totals ? parseTokenCount(totals[1]!) : null;
  const maxTokens = totals ? parseTokenCount(totals[2]!) : null;
  if (totalTokens === null || !maxTokens) return null;
  const sections = new Map<string, string[][]>();
  for (const chunk of text.split(/^### /m).slice(1)) {
    const [title, ...lines] = chunk.split("\n");
    sections.set(title!.trim().toLowerCase(), tableRows(lines));
  }
  const categoryRows = sections.get("estimated usage by category");
  if (!categoryRows?.length) return null;
  const categories: ContextReport["categories"] = [];
  for (const [name, tokens] of categoryRows) {
    const count = parseTokenCount(tokens ?? "");
    if (!name || count === null) return null;
    categories.push({ name, tokens: count, kind: categoryKind(name) });
  }
  // Each section's columns, in the order Claude Code prints them.
  const items = (
    title: string,
    pick: (
      cells: string[],
    ) => [name?: string, source?: string, tokens?: string],
  ) =>
    (sections.get(title) ?? []).flatMap((cells) => {
      const [name, source, tokens] = pick(cells);
      const count = parseTokenCount(tokens ?? "");
      return name && count !== null
        ? [{ name, tokens: count, ...(source ? { source } : {}) }]
        : [];
    });
  return {
    model,
    totalTokens,
    maxTokens,
    categories,
    mcpTools: items("mcp tools", ([tool, server, tokens]) => [
      tool,
      server,
      tokens,
    ]),
    agents: items("custom agents", ([type, source, tokens]) => [
      type,
      source,
      tokens,
    ]),
    memoryFiles: items("memory files", ([type, path, tokens]) => [
      path,
      type,
      tokens,
    ]),
    skills: items("skills", ([skill, source, tokens]) => [
      skill,
      source,
      tokens,
    ]),
  };
}

/** The newest `/context` answer Claude gave since the window was last compacted. */
export function latestContextReport(
  messages: readonly ChatMessage[],
): { report: ContextReport; at: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    if (m.compaction && m.status === "complete") return;
    if (m.provider !== "claude" || m.status !== "complete") continue;
    const report = parseContextReport(m.body);
    if (report) return { report, at: m.ended ?? m.created };
  }
}
