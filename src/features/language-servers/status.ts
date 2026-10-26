import type {
  LspServerStatus,
  LspState,
} from "../../../shared/language-servers";

/** What a server's state reads as, plain and muted: `rust-analyzer indexing… 40%`. */
export function describeStatus(status: LspServerStatus): string | null {
  const { server, state, message, progress } = status;
  const percent = progress === undefined ? "" : ` ${progress}%`;
  switch (state) {
    case "starting":
      return `${server} ${message ? message.toLowerCase() : "starting…"}`;
    case "indexing":
      return `${server} indexing…${percent}`;
    case "downloading":
      return `${server} downloading${percent || "…"}`;
    case "ready":
      return server;
    case "missing":
      return `${server} isn't installed${message ? `. ${message}` : ""}`;
    case "failed":
      return `${server} stopped${message ? `: ${message}` : ""}`;
    case "stopped":
      return null;
  }
}

/** Most worth showing first: trouble, then what is still loading. */
const priority: LspState[] = [
  "failed",
  "missing",
  "downloading",
  "indexing",
  "starting",
  "ready",
];

/** The one status worth showing when several servers run. */
export function summarizeStatuses(statuses: readonly LspServerStatus[]) {
  const mostUrgent = [...statuses]
    .filter((s) => s.state !== "stopped")
    .sort((a, b) => priority.indexOf(a.state) - priority.indexOf(b.state))[0];
  return mostUrgent ? describeStatus(mostUrgent) : null;
}

/** What `server` says it is loading, when it is; a question to it waits for that. */
export function loadingMessage(
  statuses: readonly LspServerStatus[],
  server: string | undefined,
) {
  const status = statuses.find((s) => s.server === server);
  if (status?.state !== "indexing" || !status.message) return undefined;
  return status.message.endsWith("…") ? status.message : `${status.message}…`;
}

/** `statuses` with `next` in place of the same server's earlier one. */
export function mergeStatus(
  statuses: readonly LspServerStatus[],
  next: LspServerStatus,
) {
  const rest = statuses.filter((s) => s.server !== next.server);
  return [...rest, next];
}
