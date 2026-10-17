import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { expect, it } from "vitest";
import { claudeContextReport } from "./context";

// Trimmed from what Claude Code 2.1.288 answered getContextUsage({ detail:
// "full" }) with, mid-turn, in this repo.
const counted = {
  categories: [
    { name: "System tools", tokens: 10707, color: "inactive", kind: "used" },
    {
      name: "MCP tools (deferred)",
      tokens: 2729,
      color: "inactive",
      isDeferred: true,
      kind: "deferred",
    },
    // Older CLIs leave `kind` out.
    { name: "Memory files", tokens: 5794, color: "claude" },
    { name: "Skills", tokens: 0, color: "warning", kind: "used" },
    { name: "Free space", tokens: 177633, color: "promptBorder", kind: "free" },
  ],
  totalTokens: 22367,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  percentage: 11,
  gridRows: [],
  model: "claude-haiku-4-5-20251001",
  memoryFiles: [
    { path: "/Users/me/relay/AGENTS.md", type: "Project", tokens: 1206 },
  ],
  mcpTools: [
    {
      name: "mcp__codex-cu__js_reset",
      serverName: "codex-cu",
      tokens: 119,
      isLoaded: false,
    },
  ],
  agents: [],
  skills: {
    totalSkills: 2,
    includedSkills: 2,
    tokens: 368,
    skillFrontmatter: [
      { name: "release", source: "projectSettings", tokens: 63 },
      { name: "xlsx", source: "syncedSkills", tokens: 6 },
    ],
  },
  autoCompactThreshold: 167000,
  isAutoCompactEnabled: true,
  apiUsage: null,
} as SDKControlGetContextUsageResponse;

it("reads Claude Code's live counts into the report /context's markdown gives", () => {
  expect(claudeContextReport(counted)).toEqual({
    model: "claude-haiku-4-5-20251001",
    totalTokens: 22367,
    maxTokens: 200000,
    compactsAt: 167000,
    categories: [
      { name: "System tools", tokens: 10707, kind: "used" },
      { name: "MCP tools (deferred)", tokens: 2729, kind: "deferred" },
      { name: "Memory files", tokens: 5794, kind: "used" },
      { name: "Free space", tokens: 177633, kind: "free" },
    ],
    memoryFiles: [
      { name: "/Users/me/relay/AGENTS.md", source: "Project", tokens: 1206 },
    ],
    mcpTools: [
      { name: "mcp__codex-cu__js_reset", source: "codex-cu", tokens: 119 },
    ],
    agents: [],
    skills: [
      { name: "release", source: "Project", tokens: 63 },
      { name: "xlsx", source: "claude.ai sync", tokens: 6 },
    ],
    relay: { instructions: 0, notes: 0, tools: [], loaded: 0 },
  });
});

// Shapes as Claude Code 2.1.288 answered with Relay-like tools and a
// UserPromptSubmit hook's added context.
it("finds what Relay added among Claude's counts", () => {
  const relayTool = (name: string, tokens: number, isLoaded: boolean) => ({
    name: `mcp__relay__${name}`,
    serverName: "relay",
    tokens,
    isLoaded,
  });
  const usage = {
    ...counted,
    mcpTools: [
      ...counted.mcpTools,
      relayTool("show_html", 261, true),
      relayTool("list_threads", 70, false),
    ],
    messageBreakdown: {
      attachmentsByType: [
        { name: "skill_listing", tokens: 1754 },
        { name: "hook_additional_context", tokens: 395 },
      ],
    },
  } as SDKControlGetContextUsageResponse;
  expect(claudeContextReport(usage, 620).relay).toEqual({
    instructions: 620,
    notes: 395,
    tools: [
      { name: "mcp__relay__show_html", tokens: 261 },
      { name: "mcp__relay__list_threads", tokens: 70 },
    ],
    loaded: 261,
  });
  // Without tool search every tool sits in the window, though none says it's loaded.
  const undeferred = {
    ...usage,
    categories: counted.categories.filter((c) => c.kind !== "deferred"),
  };
  expect(claudeContextReport(undeferred, 620).relay?.loaded).toBe(331);
});

it("leaves the compaction mark off when autocompact is off", () => {
  expect(
    claudeContextReport({ ...counted, isAutoCompactEnabled: false }),
  ).not.toHaveProperty("compactsAt");
});
