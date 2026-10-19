import type { HandoffTarget } from "../../../shared/handoff";

/**
 * A computer's line under its name in a pick-a-computer menu: the project it
 * goes into, or why it can't take the thread. `verb` is how the thread goes
 * on there ("Starts", "Continues").
 */
export function targetLine(target: Partial<HandoffTarget>, verb: string) {
  if (target.project) return `${verb} in ${target.project.name}`;
  if (target.clone) return "Not cloned there yet; Relay sets it up first";
  return target.problem ?? "";
}

/** Whether the thread can go to the computer: it has the project, or can get it. */
export const canPick = (target: Partial<HandoffTarget>) =>
  !!target.project || !!target.clone;
