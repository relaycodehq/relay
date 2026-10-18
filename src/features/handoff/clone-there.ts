import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { HandoffTarget } from "../../../shared/handoff";
import { api } from "../../lib/api";

/**
 * A computer's line under its name in a pick-a-computer menu: the project it
 * goes into, its clone, or why it can't take the thread. `verb` is how the
 * thread goes on there ("Starts", "Continues").
 */
export function targetLine(target: Partial<HandoffTarget>, verb: string) {
  if (target.project) return `${verb} in ${target.project.name}`;
  if (target.cloning) {
    const { progress } = target.cloning;
    return progress == null
      ? `Cloning… ${target.cloning.step}`
      : `Cloning… ${Math.round(progress * 100)}%`;
  }
  if (target.cloneError) return `Couldn't clone: ${target.cloneError}`;
  if (target.clone) return "Not cloned there yet; clones it first";
  return target.problem ?? "";
}

/** Whether picking the computer can do anything now. */
export const canPick = (target: Partial<HandoffTarget>) =>
  !!target.project || (!!target.clone && !target.cloning);

/** Refetches the menu's targets each second while a clone shows its progress. */
export const whileCloning = (targets: HandoffTarget[] | undefined) =>
  targets?.some((t) => t.cloning) ? 1000 : false;

/**
 * Clones the project on a computer that lacks it, then goes on with `then`;
 * the menu's targets show its progress and, when it fails, its error.
 */
export function useCloneThere(projectId: string, targetsKey: QueryKey) {
  const qc = useQueryClient();
  return (
    target: HandoffTarget,
    then: (project: { id: string; name: string }) => void,
  ) => {
    const job = api.cloneOnComputer(target.id, projectId);
    void qc.invalidateQueries({ queryKey: targetsKey });
    job
      .then(then, () => {
        // The menu shows why, with the agent to set it up beside it.
      })
      .finally(() => void qc.invalidateQueries({ queryKey: targetsKey }));
  };
}

/** The first message of a thread whose agent sets the computer up after a clone failed. */
export function cloneSetupPrompt(target: HandoffTarget) {
  return `Set up ${target.name} so this project's threads can run there. Relay tried to clone ${target.clone} on it and git said:

\`\`\`
${target.cloneError}
\`\`\`

Use run_on_computer to find out what's missing on ${target.name} and fix it, then clone_on_computer to clone the project and add it to Relay there. If I have to sign in somewhere, tell me exactly what to do. Don't change anything on ${target.name} the clone doesn't need.`;
}
