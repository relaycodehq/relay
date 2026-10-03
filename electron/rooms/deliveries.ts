import type { Store } from "../app/store";
import type { RoomConnection, RoomMessage, RoomPage } from "../../shared/rooms";
import { redacted } from "../../shared/redact-secrets";
import type { ProjectRoomContext, RoomAccess } from "./access";
import type { RoomConnections } from "./connections";
import type { RoomRequest } from "./transport";

/** A local agent's answer, saved before it reaches the room server so it survives going offline or a restart. */
export interface RoomDelivery {
  key: string;
  roomId: string;
  id: string;
  body: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
}

/** A saved answer as it should be sent. One still running but not on this
 * computer was cut off when the app closed. */
export function outgoing(pending: RoomDelivery, running: boolean) {
  const value = { ...pending };
  if (value.status === "running" && !running) {
    value.status = "failed";
    value.error =
      "The app closed before the answer finished. Partial output was recovered; ask again to retry.";
  }
  return value;
}

export function deliveryPatch(value: RoomDelivery) {
  return {
    body: value.status === "running" ? "" : redacted(value.body),
    status: value.status,
    error: value.error && redacted(value.error),
  };
}

/** The outbox of local answers: saving them, sending them on to the room, and
 * showing the sender their own partial answer before the room has it. */
export class RoomDeliveries {
  private flushing = new Set<string>();
  /** Projects asked to flush while one was running; it goes once more after. */
  private again = new Set<string>();
  constructor(
    private store: Store,
    private request: RoomRequest,
    private connections: RoomConnections,
    private access: RoomAccess,
    private running: (id: string) => boolean,
  ) {}
  /** `read` runs when the queued write does, so the newest text is saved. */
  save(id: string, read: () => RoomDelivery) {
    return this.store.update((s) => {
      s.roomDeliveries ??= {};
      s.roomDeliveries[id] = read();
    });
  }
  async flush(c: ProjectRoomContext) {
    if (this.flushing.has(c.key)) {
      // The running flush may have read the outbox before this save.
      this.again.add(c.key);
      return;
    }
    this.flushing.add(c.key);
    try {
      do {
        this.again.delete(c.key);
        await this.send(c);
      } while (this.again.has(c.key));
    } finally {
      this.flushing.delete(c.key);
      this.again.delete(c.key);
    }
  }
  private async send(c: ProjectRoomContext) {
    const connection = await this.connections.get(c);
    if (!connection) return;
    await this.access.ensure(c, connection);
    for (const [id, pending] of Object.entries(
      this.store.get().roomDeliveries ?? {},
    )) {
      if (pending.key !== c.key) continue;
      const value = outgoing(pending, this.running(id));
      try {
        await this.request(
          connection.server,
          `/v1/rooms/${value.roomId}/messages/${id}`,
          connection.token,
          "PATCH",
          deliveryPatch(value),
        );
      } catch {
        // Kept for the next flush; one refused answer must not hold back the rest.
        continue;
      }
      if (value.status === "running") continue;
      await this.store.update((s) => {
        if (JSON.stringify(s.roomDeliveries?.[id]) === JSON.stringify(pending))
          delete s.roomDeliveries![id];
      });
    }
  }
  /** Completed answers are shared; this sender's locally checkpointed partial
   * is overlaid only in its own desktop, never in a colleague's response. */
  async overlay(
    c: ProjectRoomContext,
    connection: RoomConnection,
    roomId: string,
    page: RoomPage,
  ) {
    for (const value of Object.values(this.store.get().roomDeliveries ?? {}))
      if (value.key === c.key && value.roomId === roomId) {
        let message = page.messages.find((m) => m.id === value.id);
        if (!message) {
          message = await this.request<RoomMessage>(
            connection.server,
            `/v1/rooms/${roomId}/messages/${value.id}`,
            connection.token,
          );
          page.messages.push(message);
        }
        Object.assign(message, {
          body: value.body,
          status: value.status,
          error: value.error,
        });
      }
  }
}
