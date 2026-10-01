// Updating the paired computer's Relay from the phone: the computer runs its
// own updater (bridge 11's updateNow) and restarts into the new version; the
// phone watches until the computer comes back on it.
import { useSyncExternalStore } from "react";
import type { RemoteClient } from "../../../shared/remote-client";
import type { UpdateState } from "../../../shared/updates";

export type ComputerUpdate =
  | { kind: "asking" }
  | { kind: "updating"; from: string; state: UpdateState }
  /** Its updater found nothing newer than what it runs. */
  | { kind: "latest" }
  | { kind: "error"; message: string };

const watchMs = 2_000;
/** A download and restart that hasn't come back by then won't. */
const giveUpMs = 15 * 60_000;

const updates = new Map<string, ComputerUpdate>();
/** Whether each computer can update itself; development builds can't. */
const selfUpdating = new Map<string, boolean>();
/** The version a computer ran when its banner was waved off, for this launch. */
const dismissed = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version++;
  for (const listener of listeners) listener();
};

function set(computer: string, update: ComputerUpdate | undefined) {
  if (update) updates.set(computer, update);
  else updates.delete(computer);
  if (update?.kind !== "updating" && update?.kind !== "asking") {
    clearInterval(timers.get(computer));
    timers.delete(computer);
  }
  changed();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the computer's updater says about itself, as the phone shows it. */
function settle(computer: string, from: string, state: UpdateState) {
  if (state.status === "error") set(computer, { kind: "error", message: state.message });
  else if (state.status === "idle" || state.status === "off")
    set(computer, { kind: "latest" });
  else if (state.status === "available" && state.install === "manual")
    set(computer, {
      kind: "error",
      message: state.reason ?? `Relay ${state.version} has to be installed there by hand.`,
    });
  else set(computer, { kind: "updating", from, state });
}

export async function updateComputer(
  computer: string,
  from: string,
  call: RemoteClient["call"],
) {
  const now = updates.get(computer)?.kind;
  if (now === "asking" || now === "updating") return;
  set(computer, { kind: "asking" });
  try {
    settle(computer, from, await call("updateNow"));
  } catch (e) {
    return set(computer, { kind: "error", message: message(e) });
  }
  if (updates.get(computer)?.kind !== "updating") return;
  const started = Date.now();
  timers.set(
    computer,
    setInterval(() => {
      if (Date.now() - started > giveUpMs)
        return set(computer, {
          kind: "error",
          message: "It hasn't come back on a new version. Check on it there.",
        });
      // Gone quiet while it restarts; the next connection says how it went.
      void call("computerInfo")
        .then((info) =>
          info.version !== from
            ? set(computer, undefined)
            : settle(computer, from, info.update),
        )
        .catch(() => {});
    }, watchMs),
  );
}

/** The computer answered on this version: an update that got it there is over. */
export function cameBack(computer: string, running: string | undefined) {
  const update = updates.get(computer);
  if (update?.kind === "updating" && running && running !== update.from)
    set(computer, undefined);
}

/** Hides the banner while the computer runs this version. */
export function dismissUpdate(computer: string, running: string | undefined) {
  if (running) dismissed.set(computer, running);
  set(computer, undefined);
}

export const isDismissed = (computer: string, running: string | undefined) =>
  !!running && dismissed.get(computer) === running;

/** Asks once per launch whether the computer can update itself at all. */
export async function probeComputer(
  computer: string,
  call: RemoteClient["call"],
) {
  if (selfUpdating.has(computer)) return;
  try {
    const info = await call("computerInfo");
    selfUpdating.set(computer, info.update.status !== "off");
    changed();
  } catch {}
}

/** Unknown until probed; a development build answers false. */
export const canSelfUpdate = (computer: string) => selfUpdating.get(computer);

export function useComputerUpdate(computer: string | undefined) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return computer ? updates.get(computer) : undefined;
}

/** Its update, in a few words. */
export function describeUpdate(name: string, update: ComputerUpdate): string {
  if (update.kind === "asking") return `Asking ${name} to update…`;
  if (update.kind === "latest") return `${name} has the latest Relay already.`;
  if (update.kind === "error")
    return `Couldn't update ${name}: ${update.message.replace(/[^.!?]$/, "$&.")}`;
  const s = update.state;
  if (s.status === "checking") return `${name} is looking for a new Relay…`;
  if (s.status === "downloading")
    return `${name} is downloading Relay ${s.version}… ${Math.round(s.progress * 100)}%`;
  if (s.status === "waiting")
    return `${name} restarts into Relay ${s.version} once its background work finishes.`;
  if ("version" in s && s.version) return `${name} is restarting into Relay ${s.version}…`;
  return `Updating ${name}…`;
}
