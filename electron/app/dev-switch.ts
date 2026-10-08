import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DevSwitchState } from "../../shared/types";
import type { Quit } from "./quit";

const run = promisify(execFile);
// Set by scripts/dev-supervisor.mjs: the main checkout, and the one running.
const home = process.env.RELAY_DEV_HOME;
const running = process.env.RELAY_DEV_RUNNING;

/** The main checkout's scripts/dev-switch.mjs, whichever checkout this Relay runs from. */
function script(args: string[]) {
  return run(
    process.execPath,
    [join(home!, "scripts", "dev-switch.mjs"), ...args],
    { cwd: home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
}

/** Under the `npm run dev` supervisor, the checkouts Relay can run from; null otherwise. */
export async function devSwitchState(): Promise<DevSwitchState | null> {
  if (!home || !running) return null;
  const { stdout } = await script(["--json"]);
  const { checkouts } = JSON.parse(stdout) as Pick<DevSwitchState, "checkouts">;
  return { running, checkouts };
}

/** Asks the supervisor to run Relay from `path`, which stops this one. */
export async function devSwitchTo(path: string) {
  if (home) await script([path]);
}

/** IPC works on Windows too, without terminating Chromium or agent hosts. */
export function listenDevSwitch(quit: Pick<Quit, "restart" | "stop">) {
  if (!process.env.RELAY_DEV_STALE || !process.send) return;
  process.on("message", (message) => {
    const request = message as { type?: unknown; detach?: unknown };
    if (request?.type !== "relay:dev-stop") return;
    const cancelled = () => process.send?.({ type: "relay:dev-cancelled" });
    if (request.detach === false) quit.stop(cancelled);
    else quit.restart(cancelled);
  });
  process.send({ type: "relay:dev-ready", restore: true });
}
