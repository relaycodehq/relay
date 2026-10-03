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
  });
});

it("leaves the compaction mark off when autocompact is off", () => {
  expect(
    claudeContextReport({ ...counted, isAutoCompactEnabled: false }),
  ).not.toHaveProperty("compactsAt");
});
