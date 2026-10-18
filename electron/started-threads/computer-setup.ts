// The tools an agent sets a paired computer up with, when Relay couldn't
// clone a project there by itself: run commands there, then clone it.
import { toolText, type RelayToolArgs } from "../relay-mcp";
import type { ThreadHandoffs } from ".";

type Setup = Pick<ThreadHandoffs, "paired" | "cloneOn" | "runOn">;

/** Asks the user, unless the thread may go ahead without. */
type Approve = (title: string, detail: string) => Promise<boolean>;

function computerNamed(handoffs: Setup, name: string) {
  const paired = handoffs.paired();
  const found = paired.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found?.online) return found;
  const names = paired.map((c) => `${c.name}${c.online ? "" : " (offline)"}`);
  throw new Error(
    found
      ? `${found.name} is offline.`
      : names.length
        ? `No paired computer is named "${name}". Paired: ${names.join(", ")}.`
        : "No other computer is paired with this Relay. The user pairs one in Settings → Computers.",
  );
}

export async function runOnComputer(
  handoffs: Setup,
  { computer, command, timeout_seconds }: RelayToolArgs<"run_on_computer">,
  approve: Approve,
) {
  const target = computerNamed(handoffs, computer);
  if (!(await approve(`Run this on ${target.name}?`, command)))
    return toolText(
      `The user didn't let you run that on ${target.name}. Ask them what they want instead.`,
      true,
    );
  const run = await handoffs.runOn(
    target.id,
    command,
    (timeout_seconds ?? 60) * 1000,
  );
  const status = run.timedOut
    ? "It ran out of time and was stopped."
    : `Exit code ${run.code}.`;
  return toolText(
    `${status}\n${run.output.trim() || "(no output)"}`,
    run.code !== 0,
  );
}

export async function cloneOnComputer(
  handoffs: Setup,
  projectId: string,
  { computer }: RelayToolArgs<"clone_on_computer">,
) {
  const target = computerNamed(handoffs, computer);
  const project = await handoffs.cloneOn(target.id, projectId);
  return toolText(
    `Cloned on ${target.name} as the project ${project.name}. Threads of this project can move or start there now.`,
  );
}
