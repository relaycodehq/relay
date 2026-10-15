// A `git` that only reads, for Cursor turns without a shell. Its SDK has no
// read-only shell: the sandbox lets commands write the workspace, so a
// reviewer gets no shell at all and this custom tool in its place. Runs in
// the Cursor worker, so it only uses Node.
import { execFile } from "node:child_process";
import type { SDKCustomTool, SDKCustomToolResult } from "@cursor/sdk";
import { gitReads, gitReadsOnly } from "../../agent-host/read-only-bash";

/** About 25k tokens; past it the model is asked to narrow what it asks for. */
export const MAX_GIT_OUTPUT = 100_000;

const text = (body: string, isError = false): SDKCustomToolResult => ({
  content: [{ type: "text", text: body }],
  ...(isError ? { isError: true } : {}),
});

export function gitTool(cwd: string, signal: AbortSignal): SDKCustomTool {
  return {
    description: `Runs git in the repository, for reading only: ${[...gitReads].join(", ")}, and listing branches, remotes and stashes. Pass the words after \`git\` as \`args\`, e.g. ["diff", "main...feature"] or ["show", "HEAD:src/app.ts"]. Use it instead of reading files under .git.`,
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description:
            'The arguments after `git`, like ["log", "--oneline", "-5"].',
        },
      },
      required: ["args"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ args }) => {
      if (!Array.isArray(args) || !args.every((a) => typeof a === "string"))
        return text("Pass `args` as a list of strings.", true);
      const words = args as string[];
      if (!gitReadsOnly(words))
        return text(
          `git ${words.join(" ")} isn't allowed: this turn only reads. Use ${[...gitReads].slice(0, 6).join(", ")} and the like.`,
          true,
        );
      return run(cwd, words, signal);
    },
  };
}

function run(cwd: string, args: string[], signal: AbortSignal) {
  return new Promise<SDKCustomToolResult>((resolve) => {
    execFile(
      "git",
      ["--no-pager", ...args],
      {
        cwd,
        signal,
        timeout: 60_000,
        maxBuffer: 64 * 1024 * 1024,
        // Not even `git status` refreshing the index: this turn changes nothing.
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_PAGER: "cat",
        },
      },
      (error, stdout, stderr) => {
        // `git grep` finding nothing exits 1 and says nothing.
        const failed = !!error && !(error.code === 1 && !stderr);
        if (failed && !stdout)
          return resolve(text(String(stderr || error!.message).trim(), true));
        const out = stdout || "(no output)";
        const cut = out.lastIndexOf("\n", MAX_GIT_OUTPUT);
        resolve(
          text(
            out.length <= MAX_GIT_OUTPUT
              ? out
              : `${out.slice(0, cut > 0 ? cut : MAX_GIT_OUTPUT)}\n\n[Cut at ${MAX_GIT_OUTPUT} of ${out.length} characters. Ask for less: \`--stat\` first, then one path at a time after \`--\`.]`,
            failed,
          ),
        );
      },
    );
  });
}
