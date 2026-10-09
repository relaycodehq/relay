import { describe, expect, it } from "vitest";
import { acpActivity, acpEdits } from "./activity";

// What amp-acp sends for Amp on a GPT model: Codex tool names, kind "other",
// and the shell result passed on as its JSON.
describe("Codex-style tools behind an ACP adapter", () => {
  it("shows a shell_command as the command it ran, with its output", () => {
    const call = {
      toolCallId: "TU-1",
      kind: "other",
      status: "completed",
      title: "shell_command: git status --short",
      rawInput: { command: "git status --short", workdir: "/p" },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: JSON.stringify({ output: " M a.ts\n", exitCode: 0 }),
          },
        },
      ],
    };
    expect(acpActivity(call)).toEqual({
      id: "TU-1",
      kind: "command",
      status: "complete",
      label: "git status --short",
      detail: " M a.ts\n",
    });
  });

  it("fails a command that exited non-zero, though the adapter called it completed", () => {
    const call = {
      toolCallId: "TU-2",
      kind: "other",
      status: "completed",
      title: "shell_command: rg x",
      rawInput: { command: "rg x" },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: JSON.stringify({
              output: "rg: command not found\n",
              exitCode: 127,
            }),
          },
        },
      ],
    };
    expect(acpActivity(call)).toMatchObject({
      status: "failed",
      detail: "rg: command not found\n",
    });
  });

  it("reports the files an apply_patch writes", () => {
    const call = {
      toolCallId: "TU-3",
      kind: "other",
      status: "completed",
      title: "apply_patch: *** Begin Patch",
      rawInput: {
        patchText:
          "*** Begin Patch\n*** Add File: src/a.ts\n+x\n*** Update File: src/b.ts\n@@\n-y\n+z\n*** End Patch",
      },
      content: [{ type: "content", content: { type: "text", text: "Done" } }],
    };
    expect(acpEdits(call)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(acpActivity(call)).toMatchObject({
      kind: "file",
      label: "src/a.ts +1 more",
    });
  });

  it("leaves an unknown tool with a command argument as a plain tool", () => {
    const call = {
      toolCallId: "TU-4",
      kind: "other",
      title: "deploy: prod",
      rawInput: { command: "prod" },
    };
    expect(acpActivity(call)).toMatchObject({
      kind: "tool",
      label: "deploy: prod",
    });
  });
});
