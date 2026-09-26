import { describe, it, expect, vi } from "vitest";
import { lineQuestionSchema, lineExcerpt } from "../../shared/questions";
import {
  aiSettingsSchema,
  codexModelArgs,
  defaultAISettings,
} from "../../shared/settings";
import { questionContext, launchLineQuestion } from "../../electron/questions";
import { inspectFolder } from "../../electron/repository";
import { openCodexTerminal } from "../../electron/local";
import type { Gitea } from "../../electron/gitea";
vi.mock("../../electron/local", () => ({ openCodexTerminal: vi.fn() }));
vi.mock("../../electron/repository", () => ({ inspectFolder: vi.fn() }));
const head = "a".repeat(40),
  base = "b".repeat(40);
const ref = { owner: "team", name: "repo", number: 7 };
const question = {
  head,
  base,
  path: "new.ts",
  start: 2,
  end: 2,
  side: "additions" as const,
  question: "Why?",
};
function fixture() {
  const file = {
    filename: "new.ts",
    previous_filename: "old.ts",
    status: "renamed",
  };
  const client = {
    account: { server: "https://example.invalid" },
    pr: () => "/pulls/7",
    pull: vi.fn(async () => ({
      head: { sha: head },
      merge_base: base,
      html_url: "https://example.invalid/team/repo/pulls/7",
      title: "Rename helper",
    })),
    files: vi.fn(async (_ref: unknown, page: number) => ({
      items: page === 1 ? [] : [file],
      nextPage: page === 1 ? 2 : null,
    })),
    contents: vi.fn(async () => ({
      old: { contents: "old\nold selected\nold nearby\n" },
      next: { contents: "new\nnew selected\nnew nearby\n" },
      binary: false,
    })),
  };
  return { client: client as unknown as Gitea, mock: client, file };
}
describe("Line question evidence", () => {
  it("loads pinned head code and old rename paths from authoritative PR metadata", async () => {
    const { client, mock, file } = fixture();
    const next = await questionContext(client, ref, question);
    expect(next).toMatchObject({
      revision: head,
      path: "new.ts",
      selection: { start: 2, end: 2 },
    });
    expect(next.lines.filter((l) => l.selected)).toEqual([
      { line: 2, text: "new selected", selected: true },
    ]);
    const old = await questionContext(client, ref, {
      ...question,
      side: "deletions",
    });
    expect(old).toMatchObject({
      revision: base,
      path: "old.ts",
      currentPath: "new.ts",
    });
    expect(old.lines[1].text).toBe("old selected");
    expect(mock.contents).toHaveBeenCalledWith(ref, file, head, base);
  });
  it("rejects stale revisions, unknown files and nonexistent lines before a session opens", async () => {
    const { client, mock } = fixture();
    await expect(
      questionContext(client, ref, { ...question, head: "c".repeat(40) }),
    ).rejects.toThrow("PR changed");
    expect(mock.contents).not.toHaveBeenCalled();
    await expect(
      questionContext(client, ref, { ...question, path: "unrelated.ts" }),
    ).rejects.toThrow("could not be found");
    await expect(
      questionContext(client, ref, { ...question, start: 4, end: 4 }),
    ).rejects.toThrow("no longer available");
  });
  it("bounds context without truncating selected lines and rejects malformed input", () => {
    const lines = lineExcerpt(
      Array.from({ length: 100 }, (_, i) => `row ${i + 1}`).join("\n"),
      50,
      52,
    );
    expect(lines).toHaveLength(53);
    expect(lines[0].line).toBe(25);
    expect(lines.at(-1)?.line).toBe(77);
    expect(lines.filter((l) => l.selected).map((l) => l.line)).toEqual([
      50, 51, 52,
    ]);
    expect(() => lineExcerpt("x".repeat(60000), 1, 1)).toThrow("too large");
    for (const change of [
      { start: 0 },
      { end: 202 },
      { start: 3 },
      { question: "   " },
      { path: "../secrets" },
      { side: "both" },
    ])
      expect(
        lineQuestionSchema.safeParse({ ...question, ...change }).success,
      ).toBe(false);
  });
  it("launches from the inspected root with revision context while preserving dirty files", async () => {
    const { client } = fixture();
    vi.mocked(inspectFolder).mockResolvedValue({
      path: "/repo/root",
      head: "c".repeat(40),
      dirty: true,
      remoteMatches: true,
    } as any);
    const choice = {
      model: "gpt-5.6-luna",
      fast: true,
      reasoningEffort: "high" as const,
    };
    await launchLineQuestion(
      client,
      "/repo/linked",
      "/app/data",
      ref,
      { ...question, side: "deletions" },
      choice,
    );
    const args = vi.mocked(openCodexTerminal).mock.calls.at(-1)!;
    expect(args[0]).toBe("/repo/root");
    expect(args[2]).toContain("working tree is modified");
    expect(args[2]).toContain('"path": "old.ts"');
    expect(args[2]).toContain(base);
    expect(args[2]).toContain("old selected");
    expect(args[2]).not.toContain("new selected");
    expect(args.slice(3)).toEqual(["read-only", choice]);
    vi.mocked(inspectFolder).mockResolvedValue({ remoteMatches: false } as any);
    await expect(
      launchLineQuestion(client, "/wrong", "/data", ref, question, choice),
    ).rejects.toThrow("remote does not match");
  });
});
describe("Model and speed settings", () => {
  it("validates custom IDs and emits explicit speed overrides, including default model", () => {
    expect(aiSettingsSchema.parse(defaultAISettings)).toEqual(
      defaultAISettings,
    );
    expect(
      codexModelArgs({ model: "", fast: false, reasoningEffort: "" }),
    ).toEqual([
      "-c",
      'service_tier="default"',
      "-c",
      "features.fast_mode=true",
    ]);
    expect(
      codexModelArgs({
        model: "gpt-5.6-luna",
        fast: true,
        reasoningEffort: "high" as const,
      }),
    ).toContain('service_tier="fast"');
    expect(
      aiSettingsSchema.safeParse({
        ...defaultAISettings,
        grouping: { model: "custom/model-v2", fast: true },
      }).success,
    ).toBe(true);
    expect(
      aiSettingsSchema.safeParse({
        ...defaultAISettings,
        grouping: { model: "--config=unsafe", fast: true },
      }).success,
    ).toBe(false);
  });
});

describe("Reasoning effort", () => {
  it("preserves existing settings behavior and validates model-specific levels", () => {
    const upgraded = aiSettingsSchema.parse({
      grouping: { model: "gpt-5.6-sol", fast: true },
      questions: { model: "gpt-5.6-luna", fast: false },
    });
    expect(upgraded.grouping).toEqual({
      model: "gpt-5.6-sol",
      fast: true,
      reasoningEffort: "medium",
    });
    expect(upgraded.questions).toEqual({
      model: "gpt-5.6-luna",
      fast: false,
      reasoningEffort: "",
    });
    expect(
      codexModelArgs(upgraded.questions).some((a) =>
        a.includes("model_reasoning_effort"),
      ),
    ).toBe(false);
    for (const [model, effort, valid] of [
      ["gpt-5.6-luna", "max", true],
      ["gpt-5.6-luna", "ultra", false],
      ["gpt-5.6-sol", "ultra", true],
      ["gpt-5.5", "max", false],
      ["custom-model", "minimal", true],
      ["gpt-5.6-sol", "invalid", false],
    ] as const) {
      expect(
        aiSettingsSchema.safeParse({
          ...upgraded,
          grouping: { model, fast: false, reasoningEffort: effort },
        }).success,
      ).toBe(valid);
    }
  });
  it("passes the chosen effort exactly once without changing the speed tier", () => {
    const args = codexModelArgs({
      model: "gpt-5.6-luna",
      fast: true,
      reasoningEffort: "max",
    });
    expect(args.filter((a) => a.includes("model_reasoning_effort"))).toEqual([
      'model_reasoning_effort="max"',
    ]);
    expect(args).toContain('service_tier="fast"');
  });
});
