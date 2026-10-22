// Recognizing Relay start_threads calls and reading the thread ids they return.
import type { AgentActivity } from "./projects";

/** A call to Relay's start_threads tool. */
export const isStartThreads = (a: AgentActivity) =>
  a.mcp?.server === "relay" && a.mcp.tool === "start_threads";

/** The ids a start_threads call's result names, when it can be read. */
export function startedIds(result: string | undefined) {
  try {
    const parsed = JSON.parse(result ?? "");
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.flatMap((t) =>
      t && typeof t.id === "string" ? [t.id] : [],
    );
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}
