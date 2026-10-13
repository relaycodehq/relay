import type { AgentActivity } from "../../../shared/projects";
import type { SubagentBook } from "../subagent-book";
import { SubagentBooks } from "../subagent-book";
import { museActivity } from "./activity";
import type { MuseConnection } from "./connection";
import { commandId, itemSchema, type MuseItem } from "./protocol";

/** Each thread's Muse subagents, kept with its session for the composer's card. */
export const museSubagentBooks = new SubagentBooks();

/**
 * A turn's subagents. Muse runs each in a child session of its own: the
 * parent's view says when one starts and ends, and following the child's
 * view shows its calls under its row.
 */
export class MuseSubagents {
  /** Child session → the subagent item that started it. */
  private children = new Map<string, string>();

  constructor(
    private connection: MuseConnection,
    private sessionId: () => string | undefined,
    private onActivity: (activity: AgentActivity) => void,
    private book?: SubagentBook,
  ) {}

  /** A `subagent` item on the parent's view, started, moved on or ended. */
  item(item: MuseItem) {
    if (item.kind !== "subagent") return;
    const id = item.itemId;
    const running = item.status === "inProgress";
    const subagentId = item.subagentId;
    const parent = this.sessionId();
    this.book?.start(id, {
      description: (item.objective || item.role || "Subagent").slice(0, 500),
      ...(item.role && { type: item.role }),
      ...(item.objective && { brief: item.objective }),
      ...(running &&
        subagentId &&
        parent && {
          stop: () =>
            this.connection.request("subagent/stop", {
              commandId: commandId(),
              sessionId: parent,
              subagentId,
            }),
        }),
    });
    if (running) {
      this.book?.progress(id, item.statusLine);
      const child = item.childSessionId;
      if (child && !this.children.has(child)) {
        this.children.set(child, id);
        void this.connection
          .request("view/subscribe", { sessionId: child })
          .catch(() => this.children.delete(child));
      }
      return;
    }
    const report = item.result?.text || item.result?.summary || item.failureReason;
    this.book?.end(
      id,
      item.status === "completed" ? "completed" : item.status === "cancelled" ? "stopped" : "failed",
      report,
    );
    if (item.childSessionId) this.unfollow(item.childSessionId);
  }

  /** A notification on a child's view: true when it was one, shown under its row. */
  notification(method: string, params: unknown) {
    const session = (params as { sessionId?: unknown } | null)?.sessionId;
    const parent = typeof session === "string" ? this.children.get(session) : undefined;
    if (!parent) return false;
    if (method !== "item/started" && method !== "item/updated" && method !== "item/completed")
      return true;
    const parsed = itemSchema.safeParse((params as { item?: unknown }).item);
    if (!parsed.success) return true;
    const item = parsed.data;
    if (item.kind === "agentMessage" && method === "item/completed" && item.text)
      this.book?.say(parent, item.itemId, item.text);
    const activity = museActivity(item, parent);
    if (activity) {
      this.onActivity(activity);
      this.book?.call(parent, activity);
    }
    return true;
  }

  private unfollow(child: string) {
    if (!this.children.delete(child)) return;
    void this.connection.request("view/unsubscribe", { sessionId: child }).catch(() => {});
  }

  /** The turn is over: stop following its children. */
  dispose() {
    for (const child of [...this.children.keys()]) this.unfollow(child);
  }
}
