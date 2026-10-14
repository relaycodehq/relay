import {
  agentName,
  helperFallbacks,
  type AgentProvider,
} from "../../shared/agents";
import {
  defaultAISettings,
  type AISettings,
  type ModelChoice,
} from "../../shared/settings";
import { NotInstalledError } from "../platform/executables";

type HelperJob = "questions" | "split" | "commitMessage" | "timesheet";

/** The model to ask `provider` for: Relay's default when that default is for it, else the agent's own. */
function fallbackChoice(job: HelperJob, provider: AgentProvider): ModelChoice {
  return provider === defaultAISettings[`${job}Provider`]
    ? defaultAISettings[job]
    : { model: "", fast: false, reasoningEffort: "" };
}

/**
 * Runs a helper job on the agent the user chose for it. Another agent steps in
 * only when the chosen one isn't installed; any other failure is the chosen
 * agent's to report, so a broken Codex shows its own error instead of Claude
 * quietly writing in its place. Every failure goes to main.log, since the
 * error the user sees is all they'd otherwise have to send.
 */
export async function runHelperJob<T>(
  settings: AISettings,
  job: HelperJob,
  signal: AbortSignal,
  run: (provider: AgentProvider, choice: ModelChoice) => Promise<T>,
): Promise<T> {
  const first = settings[`${job}Provider`];
  const providers = helperFallbacks(first);
  for (const [i, provider] of providers.entries()) {
    try {
      return await run(
        provider,
        provider === first ? settings[job] : fallbackChoice(job, provider),
      );
    } catch (error) {
      signal.throwIfAborted();
      const next = providers[i + 1];
      const missing = error instanceof NotInstalledError;
      console.warn(
        `Helper job ${job} failed on ${agentName(provider)}${missing && next ? `; trying ${agentName(next)}` : ""}:`,
        error,
      );
      if (!missing || !next) throw error;
    }
  }
  throw new Error("No agent can run Relay's helper jobs.");
}
