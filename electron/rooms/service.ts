import {
  RoomAccess,
  type ProjectRoomContext,
  type PullRoomContext,
} from "./access";
import type { Store } from "../app/store";
import { questionContext } from "../pull-requests/questions";
import { inspectFolder } from "../git/repository";
import { findExecutable } from "../platform/executables";
import {
  roomMention,
  roomInvitation,
  projectSchema,
  type RoomHosting,
  type ConnectRoom,
  type RoomState,
  type RoomPage,
  type RoomMessage,
  type SendRoom,
  type Presence,
  type Member,
  type RoomContext,
} from "../../shared/rooms";
import { roomRequest, type Network } from "./transport";
import { Hosting } from "./hosting";
import { RoomConnections, roomProject } from "./connections";
import { RoomDeliveries } from "./deliveries";
import { RoomAnswers } from "./answers";
import { redacted } from "../../shared/redact-secrets";

export type { RoomDelivery } from "./deliveries";
export class RoomService {
  private access: RoomAccess;
  private rooms = new Map<string, RoomState>();
  private request: ReturnType<typeof roomRequest>;
  private connections: RoomConnections;
  private hosting: Hosting;
  private deliveries: RoomDeliveries;
  private answers: RoomAnswers;
  constructor(
    store: Store,
    fetcher: Network,
    encrypt: (s: string) => Promise<string | null>,
    decrypt: (s: string) => Promise<string>,
  ) {
    this.access = new RoomAccess(store, (...args) => this.request(...args));
    this.request = roomRequest(fetcher, async (secret) => {
      const context = this.connections.context(secret);
      const connection = context && (await this.connections.get(context));
      if (!context || !connection) return false;
      await this.access.ensure(context, connection, true);
      return true;
    });
    this.connections = new RoomConnections(
      store,
      this.request,
      this.access,
      encrypt,
      decrypt,
      (key) => this.clearRooms(key),
    );
    this.hosting = new Hosting(store, this.request, encrypt, decrypt);
    this.deliveries = new RoomDeliveries(
      store,
      this.request,
      this.connections,
      this.access,
      (id) => this.answers.running(id),
    );
    this.answers = new RoomAnswers(this.request, this.deliveries);
  }
  async allowAccess(c: ProjectRoomContext, server: string) {
    await this.access.allow(c, server);
  }
  hostingStatus() {
    return this.hosting.status();
  }
  saveHosting(input: RoomHosting | null) {
    return this.hosting.save(input);
  }
  async state(c: PullRoomContext): Promise<RoomState> {
    const connection = await this.connections.get(c);
    if (!connection) return { connection: null, room: null };
    await this.access.ensure(c, connection);
    const key = `${c.key}:${c.ref.number}`;
    const cached = this.rooms.get(key);
    if (cached) return cached;
    const identity = await this.request<any>(
      connection.server,
      "/v1/me",
      connection.token,
    );
    if (
      JSON.stringify(projectSchema.parse(identity.project)) !==
      JSON.stringify(roomProject(c))
    )
      throw new Error(
        "This room invitation belongs to a different Gitea repository.",
      );
    const pull = await c.client.pull(c.ref);
    const room = await this.request<NonNullable<RoomState["room"]>>(
      connection.server,
      "/v1/rooms",
      connection.token,
      "POST",
      { number: c.ref.number, title: pull.title },
    );
    const { token: _, ...publicConnection } = connection;
    const state = {
      connection: {
        ...publicConnection,
        persistent: this.connections.persistent(c.key),
      },
      room,
    };
    this.rooms.set(key, state);
    return state;
  }
  async connect(c: PullRoomContext, input: ConnectRoom) {
    await this.connectProject(c, input);
    return this.state(c);
  }
  async connectProject(c: ProjectRoomContext, input: ConnectRoom) {
    await this.access.clone(c);
    if (this.answers.busy)
      throw new Error(
        "Wait for your current answer or stop it before changing rooms.",
      );
    // Verify repository access before consuming an invitation or creating membership.
    await c.client.request(c.client.repo(c.ref));
    const current = await this.connections.get(c);
    if (
      input.projectId &&
      current?.projectId === input.projectId &&
      current.server === input.server
    ) {
      await this.access.ensure(c, current);
      return current;
    }
    return this.connections.join(c, input);
  }
  async projectServer(c: ProjectRoomContext) {
    return (
      (await this.connections.get(c))?.server ??
      (await this.hosting.get())?.server ??
      null
    );
  }
  async projectSession(c: ProjectRoomContext) {
    let connection = await this.connections.get(c);
    if (!connection) {
      const hosting = await this.hosting.get();
      if (!hosting)
        throw new Error(
          "Configure room hosting in Settings or join a project invitation first.",
        );
      connection = await this.connectProject(c, hosting);
    }
    await this.access.ensure(c, connection);
    return {
      server: connection.server,
      projectId: connection.projectId,
      member: connection.member,
      request: <T>(path: string, method = "GET", body?: unknown) =>
        this.request<T>(
          connection!.server,
          path,
          connection!.token,
          method,
          body,
        ),
    };
  }
  private clearRooms(key: string) {
    for (const k of this.rooms.keys())
      if (k.startsWith(key + ":")) this.rooms.delete(k);
  }
  private async ready(c: PullRoomContext) {
    const state = await this.state(c),
      connection = await this.connections.get(c);
    if (!state.room || !connection)
      throw new Error("Connect this project to a shared room first.");
    return { connection, room: state.room };
  }
  async workspace(c: PullRoomContext) {
    const { connection, room } = await this.ready(c);
    return {
      id: `${connection.server}:${room.id}`,
      request: async (path: string, method = "GET", body?: unknown) => {
        await this.access.ensure(c, connection);
        return this.request(
          connection.server,
          `/v1/rooms/${room.id}/workspace${path}`,
          connection.token,
          method,
          body,
        );
      },
    };
  }
  async disconnect(c: PullRoomContext) {
    this.answers.stop(c.key);
    await this.connections.forget(c.key);
  }
  async poll(
    c: PullRoomContext,
    after: number,
    before?: number,
  ): Promise<RoomPage> {
    const { connection, room } = await this.ready(c);
    void this.flush(c).catch(() => {});
    const page = await this.request<RoomPage>(
      connection.server,
      `/v1/rooms/${room.id}/messages?after=${after}${before !== undefined ? `&before=${before}` : ""}`,
      connection.token,
    );
    await this.deliveries.overlay(c, connection, room.id, page);
    return page;
  }
  async invite(c: PullRoomContext) {
    if (!(await this.connections.get(c))) {
      const hosting = await this.hosting.get();
      if (!hosting)
        throw new Error(
          "Set up shared-room hosting once in Settings, or open a colleague’s invitation.",
        );
      await this.connect(c, hosting);
    }
    const { connection } = await this.ready(c);
    const invitation = await this.request<{ code: string; expiresAt: number }>(
      connection.server,
      "/v1/invites",
      connection.token,
      "POST",
      {},
    );
    return {
      code: roomInvitation(
        {
          server: connection.server,
          projectId: connection.projectId,
          secret: invitation.code,
        },
        { project: roomProject(c), number: c.ref.number },
      ),
      expiresAt: invitation.expiresAt,
    };
  }
  async members(c: PullRoomContext) {
    const { connection } = await this.ready(c);
    return this.request<Member[]>(
      connection.server,
      "/v1/members",
      connection.token,
    );
  }
  async revoke(c: PullRoomContext, id: string) {
    const { connection } = await this.ready(c);
    await this.request(
      connection.server,
      `/v1/members/${id}`,
      connection.token,
      "DELETE",
    );
  }
  async presence(
    c: PullRoomContext,
    value: Omit<Presence, "userId" | "name" | "at"> | null,
  ) {
    const { connection, room } = await this.ready(c);
    await this.request(
      connection.server,
      `/v1/rooms/${room.id}/presence`,
      connection.token,
      "PUT",
      value,
    );
  }
  async send(c: PullRoomContext, input: SendRoom) {
    const mention = roomMention(input.body);
    if (mention) {
      this.answers.check(c, mention);
      await findExecutable(mention.provider);
    }
    const { connection, room } = await this.ready(c);
    const pull = await c.client.pull(c.ref);
    if (
      pull.head.sha !== input.context.head ||
      pull.merge_base !== input.context.base
    )
      throw new Error(
        "This PR changed. Refresh before sharing this code context.",
      );
    const context: RoomContext = { ...input.context };
    if (context.start && context.end && context.path && context.side) {
      const evidence = await questionContext(c.client, c.ref, {
        ...context,
        path: context.path,
        start: context.start,
        end: context.end,
        side: context.side,
        question: input.body,
      });
      context.excerpt = JSON.stringify(evidence); // Captured from pinned Gitea blobs, never arbitrary renderer text.
    }
    const local = mention
      ? await inspectFolder(c.dir!, c.client.account.server, c.ref)
      : null;
    if (local && !local.remoteMatches)
      throw new Error("The linked folder does not match this repository.");
    const request = await this.request<RoomMessage>(
      connection.server,
      `/v1/rooms/${room.id}/messages`,
      connection.token,
      "POST",
      {
        id: input.id,
        body: redacted(input.body),
        parentId: input.parentId,
        context,
      },
    );
    if (!mention) return;
    return this.answers.ask(c, {
      connection,
      roomId: room.id,
      request,
      input,
      mention,
      pull,
      context,
      local: local!,
    });
  }
  flush(c: PullRoomContext) {
    return this.deliveries.flush(c);
  }
  cancel(c: PullRoomContext, id: string) {
    this.answers.cancel(c, id);
  }
  async dispose() {
    await this.answers.halt();
    this.rooms.clear();
    this.connections.clear();
  }
}
