import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { withTimeout } from "../../../util/timeout";
import { withProbe, type ClaudeStream } from "./sdk";
import { sessions } from "./session";

/**
 * The data behind Claude Code's /usage, fetched by the CLI with its own
 * sign-in; Relay never handles the token. Null when the CLI is signed out.
 * A running session answers without starting another process.
 */
export async function readClaudeUsage(): Promise<SDKControlGetUsageResponse | null> {
  const live = [...sessions.values()].at(-1);
  if (live) {
    try {
      const usage = await usageFrom(live.stream, 5000);
      // Sessions left running for hours stop reporting the plan's limits.
      if (!usage || usage.rate_limits_available) return usage;
    } catch {
      // Closing or stuck behind its turn; a fresh probe still answers.
    }
  }
  return withProbe({ settingSources: ["user"] }, (stream) =>
    usageFrom(stream, 20000),
  );
}
async function usageFrom(stream: ClaudeStream, ms: number) {
  const ask = async () => {
    const account = await stream.accountInfo();
    if (account?.tokenSource === "none" && !account.apiKeySource) return null;
    // Experimental in the SDK; when it's renamed, this stops type-checking.
    return stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
  };
  return withTimeout(ask(), ms, "Claude did not report usage.");
}
