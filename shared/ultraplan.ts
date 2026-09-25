// Ultraplan: before the lead plans, a small council of thinkers on other
// models thinks the request over. The lead writes one brief; each thinker
// works from it in a hidden, read-only thread and never sees the others;
// then the lead checks their notes in the code and plans in Plan mode.
// "angles" gives each thinker a job of its own; with "same" they all get the
// same task, so what they agree on carries weight.
import type { AgentProvider, HelperProvider } from "./agents";
import { z } from "zod";
import type { RuntimeMode } from "./agent-modes";
import type { ModelChoice } from "./settings";

export const ultraplanKindSchema = z.enum(["angles", "same"]);
export type UltraplanKind = z.infer<typeof ultraplanKindSchema>;

export type ThinkerJob = "skeptic" | "scout" | "route";
export const thinkerJobs: Record<ThinkerJob, { label: string; gist: string }> =
  {
    skeptic: { label: "Skeptic", gist: "How it goes wrong" },
    scout: { label: "Codebase scout", gist: "What already exists to reuse" },
    route: { label: "Other route", gist: "A different approach" },
  };

export interface Thinker {
  provider: HelperProvider;
  choice: ModelChoice;
  /** Unset when every thinker gets the same task. */
  job?: ThinkerJob;
}

const high = (model: string): ModelChoice => ({
  model,
  reasoningEffort: "high",
  fast: false,
});
/**
 * The council is fixed, so Ultraplan is one pick. Model families disagree
 * more usefully than copies of one model, and the thread's own agent leads.
 */
export function council(kind: UltraplanKind): Thinker[] {
  const members: Thinker[] = [
    // Codex's own model: the most rigorous about what breaks.
    { provider: "codex", choice: high(""), job: "skeptic" },
    // Quick through the code, which a scout reads the most of.
    { provider: "claude", choice: high("sonnet"), job: "scout" },
    { provider: "claude", choice: high("opus"), job: "route" },
  ];
  return kind === "angles"
    ? members
    : members.map((m) => ({ provider: m.provider, choice: m.choice }));
}

export type UltraplanStatus =
  "briefing" | "thinking" | "leading" | "done" | "stopped" | "failed";
/** A council on one request, kept on the thread by that user message's id. */
export interface UltraplanState {
  kind: UltraplanKind;
  status: UltraplanStatus;
  /** The lead's brief: an answer in the thread, shown inside the council. */
  brief: string;
  /** Each thinker works in a hidden thread of its own. */
  thinkers: (Thinker & { chatId: string })[];
  /** The request's agent and settings; its plan runs in Plan mode. */
  lead: {
    provider: AgentProvider;
    choice: ModelChoice;
    runtimeMode: RuntimeMode;
  };
  /** The lead's plan, once it started. */
  answer?: string;
}
/** A thinker thread's place in its council. */
export interface ThinkerTask {
  parent: string;
  /** The user message whose council this is. */
  request: string;
  slot: number;
}

/** The council working on this thread's requests holds new messages back. */
export const councilWorking = (states: UltraplanState[]) =>
  states.some(
    (s) =>
      s.status === "briefing" ||
      s.status === "thinking" ||
      (s.status === "leading" && !s.answer),
  );
