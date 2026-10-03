import type { Gitea } from "../pull-requests/gitea";
import type { Store } from "../app/store";
import type { RoomConnection } from "../../shared/rooms";
import type { PullRef } from "../../shared/types";
import { inspectRepository } from "../git/repository";
import type { RoomRequest } from "./transport";
export interface ProjectRoomContext {
  client: Gitea;
  ref: { owner: string; name: string };
  key: string;
  dir?: string;
}
export type PullRoomContext = ProjectRoomContext & { ref: PullRef };
export class RoomAccess {
  private checked = new Map<string, number>();
  private inFlight = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    private request: RoomRequest,
  ) {}
  private consentKey(c: ProjectRoomContext, server: string) {
    return JSON.stringify([
      c.client.account.id,
      server,
      c.ref.owner,
      c.ref.name,
    ]);
  }
  async allow(c: ProjectRoomContext, server: string) {
    await this.clone(c);
    await this.store.update((s) => {
      (s.roomAccessConsents ??= {})[this.consentKey(c, server)] = true;
    });
  }
  async clone(c: ProjectRoomContext) {
    if (!c.dir)
      throw new Error(
        "Link a matching local clone before opening shared conversations.",
      );
    const local = await inspectRepository(
      c.dir,
      c.client.account.server,
      c.ref,
    );
    if (!local.remoteMatches)
      throw new Error("This local clone does not match the shared repository.");
  }
  async credential<T>(
    c: ProjectRoomContext,
    server: string,
    send: (token: string) => Promise<T>,
  ) {
    await this.clone(c);
    if (!this.store.get().roomAccessConsents?.[this.consentKey(c, server)])
      throw new Error(
        "Verify shared access first. The room server needs your permission to check Gitea access using your existing sign-in.",
      );
    const health = await this.request<{ repositoryAccess?: boolean }>(
      server,
      "/health",
      undefined,
    );
    if (health.repositoryAccess !== true)
      throw new Error(
        "This room server must be updated to support Gitea repository access checks before sharing.",
      );
    return c.client.withRepositoryCredential(send);
  }
  async ensure(
    c: ProjectRoomContext,
    connection: RoomConnection,
    force = false,
  ) {
    await this.clone(c);
    const key = connection.token;
    if (!force && (this.checked.get(key) ?? 0) > Date.now()) return;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const job = this.credential(c, connection.server, (token) =>
      this.request<{ expiresAt: number }>(
        connection.server,
        "/v1/access",
        key,
        "POST",
        { giteaToken: token },
      ),
    ).then((value) => {
      this.checked.set(
        key,
        Math.min(value.expiresAt - 5000, Date.now() + 45000),
      );
    });
    this.inFlight.set(key, job);
    try {
      await job;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
