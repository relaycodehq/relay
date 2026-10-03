import type {
  AwayState,
  AwayThread,
  ComputersOverview,
  PairedComputer,
} from "../../../shared/handoff";

export type Computer = ComputersOverview["computers"][number];

export const stateWord: Record<AwayState, string> = {
  sending: "on its way",
  working: "working",
  waiting: "waiting for you",
  finished: "finished",
  stopped: "stopped with an error",
  returning: "coming back",
  failed: "didn't arrive",
  unknown: "can't check while it's offline",
};

function ago(since: number, now: number) {
  const minutes = Math.max(0, Math.round((now - since) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export function threadLine(t: AwayThread, now: number) {
  if (t.state === "failed") return t.error ?? stateWord.failed;
  if (t.state === "stopped") {
    // Agent errors run long (a whole stderr); the thread itself has the rest.
    const why = t.error?.split("\n")[0];
    if (!why) return stateWord.stopped;
    return `stopped · ${why.length > 120 ? why.slice(0, 119) + "…" : why}`;
  }
  if (t.state === "finished") {
    const when = ago(t.since, now);
    return when === "just now" ? "finished just now" : `finished ${when} ago`;
  }
  if (t.state === "working" || t.state === "waiting")
    return `${stateWord[t.state]} · ${ago(t.since, now)}`;
  return stateWord[t.state];
}

export function computerLine(c: PairedComputer) {
  if (c.status === "online") return "Connected";
  if (c.status === "connecting") return "Connecting…";
  if (c.status === "denied")
    return "It no longer accepts this computer. Pair again.";
  return c.detail ? `Offline · ${c.detail}` : "Offline";
}

/** An update under way on the other computer, in a few words. */
export function updating(c: Computer) {
  const u = c.update;
  if (u?.status === "downloading")
    return `Downloading ${u.version} · ${Math.round(u.progress * 100)}%`;
  if (u?.status === "ready" || u?.status === "installing")
    return `Restarting into ${u.version}…`;
  if (u?.status === "waiting")
    return `Updating to ${u.version} once its background work ends`;
}

export function summary(c: Computer) {
  if (c.status === "offline") return "Offline";
  if (c.status !== "online") return computerLine(c);
  const busy = updating(c);
  if (busy) return busy;
  if (c.outdated) return "Needs a Relay update";
  if (!c.threads.length) return "Connected";
  return `Connected · ${c.threads.length} ${c.threads.length === 1 ? "thread" : "threads"}`;
}
