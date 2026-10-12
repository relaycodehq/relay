import type { ChatMessage } from "./projects/messages";
import { formatDollars } from "./openrouter-credit";

/**
 * What a thread's answers cost where their agent priced them: OpenCode and
 * ACP agents billed per token. Plan, free and local models price at $0, and
 * Claude and Codex price nothing, so those threads have no cost to show.
 */
export interface ThreadCost {
  usd: number;
  /** Answers that cost something. */
  answers: number;
  /** Most expensive first. */
  models: { name: string; usd: number }[];
}

export function threadCost(
  messages: readonly ChatMessage[],
): ThreadCost | undefined {
  const byModel = new Map<string, number>();
  let usd = 0;
  let answers = 0;
  for (const m of messages) {
    if (!m.cost || !(m.cost > 0)) continue;
    usd += m.cost;
    answers++;
    const name = m.model?.name || "Default model";
    byModel.set(name, (byModel.get(name) ?? 0) + m.cost);
  }
  if (!answers) return undefined;
  return {
    usd,
    answers,
    models: [...byModel]
      .map(([name, usd]) => ({ name, usd }))
      .sort((a, b) => b.usd - a.usd),
  };
}

export const formatCost = (usd: number) =>
  usd < 0.01 ? "<$0.01" : formatDollars(usd);
