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

type HelperJob = "questions" | "split" | "commitMessage" | "timesheet";

/**
 * Each agent a helper job tries, with the model to ask it for: the user's pick
 * on their agent, Relay's default on the agent that default is for, and the
 * agent's own default anywhere else. Handing a fallback agent Relay's default
 * gave Claude a Codex model whenever Codex was missing or signed out.
 */
export function helperAttempts(
  settings: AISettings,
  job: HelperJob,
): { provider: AgentProvider; choice: ModelChoice }[] {
  const first = settings[`${job}Provider`];
  return helperFallbacks(first).map((provider) => ({
    provider,
    choice:
      provider === first
        ? settings[job]
        : provider === defaultAISettings[`${job}Provider`]
          ? defaultAISettings[job]
          : { model: "", fast: false, reasoningEffort: "" },
  }));
}

/** Every agent's failure, the user's own agent first, so a fallback's error doesn't hide why theirs failed. */
export function helperFailure(
  failures: { provider: AgentProvider; error: unknown }[],
  otherwise: string,
): Error {
  if (!failures.length) return new Error(otherwise);
  if (failures.length === 1 && failures[0].error instanceof Error)
    return failures[0].error;
  return new Error(
    failures
      .map(({ provider, error }) => {
        const said = (error instanceof Error ? error.message : String(error))
          .trim()
          .replace(/(?<![.!?])$/, ".");
        return `${agentName(provider)}: ${said}`;
      })
      .join(" "),
  );
}
