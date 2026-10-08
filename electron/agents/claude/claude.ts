import { terminate } from "../../platform/terminate";
import { runClaudeProject, type ClaudeRunOptions } from "./project";
import { claudeImages } from "./project/sdk";
import { ANSWER_LIMIT, answerLimitError } from "../turn-kit";
import { findExecutable, spawnExecutable } from "../../platform/executables";
import { ClaudeFailureWatch, claudeReason } from "./claude-failure";
import { runAccount } from "../accounts";
import { RequestUsage } from "./request-usage";
export async function runClaude(options: ClaudeRunOptions): Promise<string> {
  const { job } = options;
  // Only one-off jobs run as a bare `--print`; the rest are a thread's session.
  if (job.kind !== "helper") return runClaudeProject(options);
  const executable = await findExecutable("claude");
  const { env } = await runAccount("claude", options.account);
  options.signal.throwIfAborted();
  const images = await claudeImages(options.images);
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnExecutable(
      executable,
      [
        "--print",
        ...(images.length ? ["--input-format", "stream-json"] : []),
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--restricted",
        "--safe-mode",
        "--tools",
        "",
        "--allowedTools",
        "",
        "--disallowedTools",
        "mcp__*",
        "--permission-mode",
        "dontAsk",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        ...(options.model ? ["--model", options.model] : []),
        ...(options.effort ? ["--effort", options.effort] : []),
        "--append-system-prompt",
        job.instructions,
      ],
      { cwd: options.cwd, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const failures = new ClaudeFailureWatch();
    const requests = new RequestUsage();
    let buffer = "",
      answer = "",
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      child.stdin.end();
      terminate(child);
      if (error) reject(error);
      else resolve(answer);
    };
    const abort = () => finish(new Error("Cancelled by you."));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "Claude reached the 10-minute question limit. Partial output was kept.",
          ),
        ),
      600000,
    );
    options.signal.addEventListener("abort", abort, { once: true });
    child.on("error", (e) =>
      finish(new Error(`Could not start Claude: ${e.message}`)),
    );
    // "close", not "exit": stdout may still hold the final result line when
    // the process exits.
    child.on("close", () =>
      finish(
        new Error(
          "Claude stopped before finishing. Check your Claude Code sign-in and version (2.1.248 or newer).",
        ),
      ),
    );
    child.stderr.resume();
    child.stdin.on("error", () =>
      finish(new Error("The Claude connection closed.")),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4_000_000) {
        finish(new Error("Claude sent an oversized protocol message."));
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          failures.see(m);
          requests.observe(m, options.onUsage);
          if (
            m.type === "stream_event" &&
            m.event?.type === "content_block_delta" &&
            m.event.delta?.type === "text_delta"
          ) {
            answer += m.event.delta.text;
            const over = answerLimitError(answer.length);
            if (over) {
              finish(over);
              return;
            }
            options.onText(answer);
          }
          if (m.type === "result") {
            const failed = m.is_error || m.subtype !== "success";
            // A refused request can still end in a "successful" result.
            const stopped = failures.failure(failed);
            if (stopped || failed) {
              const reason = claudeReason(m.result);
              finish(
                stopped ??
                  new Error(
                    reason
                      ? `Claude could not complete this question: ${reason}`
                      : "Claude could not complete this question. Check your local Claude Code account and model settings.",
                  ),
              );
              return;
            }
            if (typeof m.result === "string") {
              answer = m.result.slice(0, ANSWER_LIMIT);
              options.onText(answer);
            }
            finish(
              answer.trim()
                ? undefined
                : new Error("Claude returned an empty answer."),
            );
          }
        } catch {
          finish(new Error("Claude returned an invalid protocol message."));
        }
      }
    });
    child.stdin.end(
      images.length
        ? JSON.stringify({
            type: "user",
            session_id: "",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                ...(options.prompt
                  ? [{ type: "text", text: options.prompt }]
                  : []),
                ...images,
              ],
            },
          }) + "\n"
        : options.prompt,
    );
  });
}
