import { randomBytes, createHash } from "node:crypto";
import type { Store } from "../store";
import {
  connectionSchema,
  projectSchema,
  type ConnectRoom,
  type RoomConnection,
} from "../../shared/rooms";
import type { ProjectRoomContext, RoomAccess } from "./access";
import type { RoomRequest } from "./transport";

export function roomProject(c: ProjectRoomContext) {
  return projectSchema.parse({
    server: c.client.account.server,
    owner: c.ref.owner,
    name: c.ref.name,
  });
}

/** Each project's membership on a room server, sealed in the store and
 * cached once opened, and the session tokens of joins still in flight. */
export class RoomConnections {
  private connections = new Map<string, RoomConnection>();
  private contexts = new Map<string, ProjectRoomContext>();
  private pendingJoins = new Map<string, string>();
  constructor(
    private store: Store,
    private request: RoomRequest,
    private access: RoomAccess,
    private encrypt: (s: string) => Promise<string | null>,
    private decrypt: (s: string) => Promise<string>,
    private changed: (key: string) => void,
  ) {}
  async get(c: ProjectRoomContext) {
    let connection = this.connections.get(c.key);
    if (!connection && this.store.get().roomConnections?.[c.key]) {
      connection = connectionSchema.parse(
        JSON.parse(
          await this.decrypt(this.store.get().roomConnections![c.key]),
        ),
      );
      this.connections.set(c.key, connection);
    }
    if (connection) this.contexts.set(connection.token, c);
    return connection;
  }
  /** The project last opened with this session token. */
  context(token: string) {
    return this.contexts.get(token);
  }
  persistent(key: string) {
    return !!this.store.get().roomConnections?.[key];
  }
  async join(c: ProjectRoomContext, input: ConnectRoom) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([c.key, input]))
      .digest("hex");
    // Save the client-generated session token before redeeming a one-use invitation. A lost response is retryable.
    let token = this.pendingJoins.get(fingerprint);
    const pending = this.store.get().roomJoins?.[fingerprint];
    if (!token && pending) token = await this.decrypt(pending);
    if (!token) {
      token = randomBytes(32).toString("base64url");
    }
    this.pendingJoins.set(fingerprint, token);
    if (!pending) {
      const encrypted = await this.encrypt(token);
      if (encrypted)
        await this.store.update((s) => {
          s.roomJoins ??= {};
          s.roomJoins[fingerprint] = encrypted;
        });
    }
    const name = (
      c.client.account.user.full_name || c.client.account.user.login
    ).slice(0, 80);
    const identity = await this.access.credential(
      c,
      input.server,
      (giteaToken) =>
        this.request<any>(
          input.server,
          input.projectId ? "/v1/join" : "/v1/projects",
          input.projectId ? undefined : input.secret,
          "POST",
          input.projectId
            ? {
                projectId: input.projectId,
                code: input.secret,
                project: roomProject(c),
                name,
                sessionToken: token,
                giteaToken,
              }
            : {
                project: roomProject(c),
                name,
                sessionToken: token,
                giteaToken,
              },
        ),
    );
    const connection = connectionSchema.parse({
      server: input.server,
      token,
      ...identity,
    });
    if (JSON.stringify(connection.project) !== JSON.stringify(roomProject(c)))
      throw new Error(
        "This invitation belongs to another repository. Open that repository’s PR first.",
      );
    const encrypted = await this.encrypt(JSON.stringify(connection));
    await this.store.update((s) => {
      s.roomConnections ??= {};
      if (encrypted) s.roomConnections[c.key] = encrypted;
      else delete s.roomConnections[c.key];
      if (s.roomJoins) delete s.roomJoins[fingerprint];
    });
    this.pendingJoins.delete(fingerprint);
    this.connections.set(c.key, connection);
    this.changed(c.key);
    return connection;
  }
  async forget(key: string) {
    await this.store.update((s) => {
      if (s.roomConnections) delete s.roomConnections[key];
    });
    this.connections.delete(key);
    this.changed(key);
  }
  clear() {
    this.connections.clear();
    this.pendingJoins.clear();
  }
}
