import { expect, it } from "vitest";
import type { ChatMessage } from "./projects";
import {
  latestContextReport,
  parseContextReport,
  parseTokenCount,
} from "./context-report";

// Captured from Claude Code 2.1.288 answering `/context` through the Agent
// SDK (Haiku, this repo); only the home folder is renamed.
const captured = `## Context Usage

**Model:** claude-haiku-4-5-20251001  
**Tokens:** 23.5k / 200k (12%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System tools | 10.7k | 5.4% |
| MCP server instructions | 560 | 0.3% |
| MCP tools (deferred) | 2.7k | 1.4% |
| System tools (deferred) | 17.6k | 8.8% |
| Memory files | 5.8k | 2.9% |
| Skills | 2k | 1.0% |
| Messages | 4.4k | 2.2% |
| Free space | 176.5k | 88.3% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__claude_ai_Claude_Docs__batch | claude_ai_Claude_Docs | 127 |
| mcp__claude_ai_Claude_Docs__create | claude_ai_Claude_Docs | 197 |
| mcp__claude_ai_Claude_Docs__delete | claude_ai_Claude_Docs | 265 |
| mcp__claude_ai_Claude_Docs__export | claude_ai_Claude_Docs | 251 |
| mcp__claude_ai_Claude_Docs__guide | claude_ai_Claude_Docs | 161 |
| mcp__claude_ai_Claude_Docs__query | claude_ai_Claude_Docs | 140 |
| mcp__claude_ai_Claude_Docs__read | claude_ai_Claude_Docs | 251 |
| mcp__claude_ai_Claude_Docs__update | claude_ai_Claude_Docs | 230 |
| mcp__codex-cu__js | codex-cu | 857 |
| mcp__codex-cu__js_add_node_module_dir | codex-cu | 131 |
| mcp__codex-cu__js_reset | codex-cu | 119 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| User | /Users/me/.claude/CLAUDE.md | 545 |
| Project | /Users/me/relay/CLAUDE.md | 12 |
| Project | /Users/me/relay/AGENTS.md | 1.2k |
| AutoMem | /Users/me/.claude/projects/-Users-me-relay/memory/MEMORY.md | 4k |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| computer-use | User | ~100 |
| git-split-logical-commits | User | ~80 |
| release | Project | ~60 |
| web-interface-guidelines | User | ~20 |
| dataviz | Built-in | ~360 |
| update-config | Built-in | ~180 |
| keybindings-help | Built-in | ~60 |
| code-review | Built-in | ~250 |
| simplify | Built-in | ~50 |
| fewer-permission-prompts | Built-in | ~50 |
| loop | Built-in | ~90 |
| schedule | Built-in | ~100 |
| claude-api | Built-in | ~270 |
| workflow-authoring | Built-in | ~60 |
| run | Built-in | ~90 |
| plugin-authoring | Built-in | ~60 |
| init | Built-in | < 20 |
| security-review | Built-in | ~20 |
| docs | claude.ai sync | < 20 |
| docx | claude.ai sync | < 20 |
| google-workspace | claude.ai sync | < 20 |
| import-memory | claude.ai sync | < 20 |
| morning | claude.ai sync | < 20 |
| pdf | claude.ai sync | < 20 |
| pptx | claude.ai sync | < 20 |
| skill-creator | claude.ai sync | < 20 |
| xlsx | claude.ai sync | < 20 |`;

it("reads a real /context answer", () => {
  const report = parseContextReport(captured)!;
  expect(report.model).toBe("claude-haiku-4-5-20251001");
  expect(report.totalTokens).toBe(23_500);
  expect(report.maxTokens).toBe(200_000);
  expect(report.categories).toEqual([
    { name: "System tools", tokens: 10_700, kind: "used" },
    { name: "MCP server instructions", tokens: 560, kind: "used" },
    { name: "MCP tools (deferred)", tokens: 2_700, kind: "deferred" },
    { name: "System tools (deferred)", tokens: 17_600, kind: "deferred" },
    { name: "Memory files", tokens: 5_800, kind: "used" },
    { name: "Skills", tokens: 2_000, kind: "used" },
    { name: "Messages", tokens: 4_400, kind: "used" },
    { name: "Free space", tokens: 176_500, kind: "free" },
  ]);
  expect(report.mcpTools).toHaveLength(11);
  expect(report.mcpTools.at(-3)).toEqual({
    name: "mcp__codex-cu__js",
    source: "codex-cu",
    tokens: 857,
  });
  expect(report.memoryFiles[2]).toEqual({
    name: "/Users/me/relay/AGENTS.md",
    source: "Project",
    tokens: 1_200,
  });
  expect(report.skills).toHaveLength(27);
  expect(report.skills[0]).toEqual({
    name: "computer-use",
    source: "User",
    tokens: 100,
  });
  expect(report.skills.at(-1)).toEqual({
    name: "xlsx",
    source: "claude.ai sync",
    tokens: 20,
  });
  expect(report.agents).toEqual([]);
});

// Rows this session didn't have, written the way Claude Code's formatter
// prints them (from its source, not captured).
it("reads the rows and sections a fuller session adds", () => {
  const report = parseContextReport(
    [
      "## Context Usage",
      "",
      "**Model:** claude-opus-4-7[1m]  ",
      "**Tokens:** 1.1M / 1M (110%)",
      "**Over limit:** Context exceeds the 1M-token limit by 100k tokens \u2014 run /compact or /clear to continue.",
      "",
      "### Estimated usage by category",
      "",
      "| Category | Tokens | Percentage |",
      "|----------|--------|------------|",
      "| System prompt | 3.2k | 0.3% |",
      "| Custom agents | 1,240 | 0.1% |",
      "| Messages | 1.1M | 109.6% |",
      "| Autocompact buffer | 33k | 3.3% |",
      "",
      "### Custom Agents",
      "",
      "| Agent Type | Source | Tokens |",
      "|------------|--------|--------|",
      "| reviewer | Project | 1.2k |",
      "",
    ].join("\n"),
  )!;
  expect(report.totalTokens).toBe(1_100_000);
  expect(report.maxTokens).toBe(1_000_000);
  expect(report.categories.map((c) => [c.name, c.tokens, c.kind])).toEqual([
    ["System prompt", 3_200, "used"],
    ["Custom agents", 1_240, "used"],
    ["Messages", 1_100_000, "used"],
    ["Autocompact buffer", 33_000, "buffer"],
  ]);
  expect(report.agents).toEqual([
    { name: "reviewer", source: "Project", tokens: 1_200 },
  ]);
});

it("leaves answers it doesn't recognise alone", () => {
  expect(parseContextReport("Here is how the context looks: fine.")).toBeNull();
  expect(parseContextReport("## Context Usage\n\nSomething new")).toBeNull();
  // A category row it can't read means the format moved on.
  expect(
    parseContextReport(
      captured.replace("| Skills | 2k |", "| Skills | about two thousand |"),
    ),
  ).toBeNull();
});

it("parses token counts as Claude Code prints them", () => {
  expect(parseTokenCount("560")).toBe(560);
  expect(parseTokenCount("23.5k")).toBe(23_500);
  expect(parseTokenCount("1.2M")).toBe(1_200_000);
  expect(parseTokenCount("~100")).toBe(100);
  expect(parseTokenCount("< 20")).toBe(20);
  expect(parseTokenCount("1,240")).toBe(1_240);
  expect(parseTokenCount("lots")).toBeNull();
});

const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m",
  role: "assistant",
  body: "",
  status: "complete",
  created: 1,
  provider: "claude",
  version: 1,
  ...over,
});

it("finds the newest report since the last compaction", () => {
  const older = message({ id: "a", body: captured, created: 10 });
  const newer = message({ id: "b", body: captured, created: 20, ended: 25 });
  const answer = message({ id: "c", body: "Done.", created: 30 });
  expect(latestContextReport([older, newer, answer])?.at).toBe(25);
  expect(
    latestContextReport([newer, message({ compaction: true }), answer]),
  ).toBeUndefined();
  expect(
    latestContextReport([message({ body: captured, provider: "codex" })]),
  ).toBeUndefined();
});
