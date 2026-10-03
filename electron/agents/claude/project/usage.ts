import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { withTimeout } from "../../../util/timeout";
import { SYSTEM_ACCOUNT } from "../../../../shared/agent-accounts";
import { signedInAs } from "../../accounts";
import { withProbe, type ClaudeStream } from "./sdk";
import { sessions } from "./session";

/**
 * The data behind Claude Code's /usage for one account, fetched by the CLI
 * with its own sign-in; Relay never handles the token. Null when the account
 * is signed out. A running session on it answers without starting another
 * process.
 */
export async function readClaudeUsage(
  account = SYSTEM_ACCOUNT,
): Promise<SDKControlGetUsageResponse | null> {
  const live = [...sessions.values()]
    .filter((s) => (s.account ?? SYSTEM_ACCOUNT) === account)
    .at(-1);
  if (live) {
    try {
      const usage = await usageFrom(live.stream, 5000);
      // Sessions left running for hours stop reporting the plan's limits.
      if (!usage || usage.rate_limits_available) return usage;
    } catch {
      // Closing or stuck behind its turn; a fresh probe still answers.
    }
  }
  // This account's own, even one that's gone: never another's limits.
  const env = await signedInAs("claude", account);
  return withProbe({ settingSources: ["user"], env }, (stream) =>
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
