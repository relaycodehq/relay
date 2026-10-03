import { git } from "../git/git";
import type { Projects } from "./projects";
import type { RoomService } from "../rooms/service";
import type { Gitea } from "../pull-requests/gitea";
import type {
  ProjectChat,
  ChatMessage,
  ChatSummary,
} from "../../shared/projects";
import { roomInvitation, parseRoomInvitation } from "../../shared/rooms";
import { redacted } from "../../shared/redact-secrets";
import { truncated } from "../../shared/truncate";
type SharedPage = {
  conversation: {
    id: string;
    title: string;
    scope: ChatSummary["scope"];
    updated: number;
  };
  messages: ChatMessage[];
  next: number;
  more: boolean;
};
/** The most characters the server keeps of a shared message. */
const SHARED_BODY_CHARACTERS = 100_000;
export const publicMessage = ({
  id,
  role,
  body,
  status,
  created,
  provider,
  error,
  version,
  parentId,
}: ChatMessage) => ({
  id,
  role,
  body: truncated(redacted(body), SHARED_BODY_CHARACTERS),
  status,
  created,
  provider,
  ...(error ? { error: redacted(error).slice(0, 1000) } : {}),
  version,
  ...(parentId ? { parentId } : {}),
});
export class ProjectSharing {
  constructor(
    private projects: Projects,
    private rooms: RoomService,
    private client: () => Gitea,
  ) {}
  private async context(id: string) {
    const client = this.client(),
      repo = await this.projects.linked(id, client);
    return {
      client,
      ref: repo,
      key: JSON.stringify([client.account.id, repo.owner, repo.name]),
      dir: await this.projects.root(id),
    };
  }
  async info(id: string) {
    const c = await this.context(id);
    return {
      server: await this.rooms.projectServer(c),
      project: `${c.ref.owner}/${c.ref.name}`,
    };
  }
  async allow(id: string) {
    const c = await this.context(id),
      server = await this.rooms.projectServer(c);
    if (!server)
      throw new Error(
        "Configure shared-room hosting in Settings, or open a colleague’s invitation first.",
      );
    await this.rooms.allowAccess(c, server);
  }
  private async session(chat: Pick<ProjectChat, "projectId" | "shared">) {
    const session = await this.rooms.projectSession(
      await this.context(chat.projectId),
    );
    if (chat.shared && chat.shared.server !== session.server)
      throw new Error(
        "This chat belongs to another room server. Reconnect its original project.",
      );
    return session;
  }
  async share(chat: ProjectChat) {
    const s = await this.session(chat);
    await s.request("/v1/conversations", "POST", {
      id: chat.id,
      title: redacted(chat.title),
      scope: chat.scope,
      messages: chat.messages.map(publicMessage),
    });
    return { server: s.server, roomId: chat.id, memberId: s.member.id };
  }
  async send(chat: ProjectChat, messages: ChatMessage[]) {
    const s = await this.session(chat);
    return s.request<ChatMessage[]>(
      `/v1/conversations/${chat.shared!.roomId}/messages`,
      "POST",
      { messages: messages.map(publicMessage) },
    );
  }
  async poll(chat: ProjectChat, after: number) {
    const s = await this.session(chat);
    return s.request<SharedPage>(
      `/v1/conversations/${chat.shared!.roomId}/messages?after=${after}`,
    );
  }
  async list(id: string) {
    const s = await this.session({ projectId: id });
    const rows = await s.request<
      {
        id: string;
        title: string;
        scope: ChatSummary["scope"];
        updated: number;
      }[]
    >("/v1/conversations");
    return rows.map((row) => ({
      id: row.id,
      projectId: id,
      title: row.title,
      scope: row.scope,
      created: row.updated,
      updated: row.updated,
      shared: { server: s.server, roomId: row.id, memberId: s.member.id },
    }));
  }
  async presence(
    chat: ProjectChat,
    value: { path: string | null; viewed: number; total: number } | null,
  ) {
    const c = await this.context(chat.projectId),
      s = await this.session(chat);
    await s.request(
      `/v1/rooms/${chat.shared!.roomId}/presence`,
      "PUT",
      value
        ? { ...value, head: (await git(c.dir!, ["rev-parse", "HEAD"])).trim() }
        : null,
    );
    return s.request<import("../../shared/rooms").Presence[]>(
      `/v1/rooms/${chat.shared!.roomId}/presence`,
    );
  }
  async workspace(chat: ProjectChat) {
    const context = await this.context(chat.projectId),
      session = await this.session(chat);
    if (!chat.shared)
      throw new Error("Share this conversation before syncing files.");
    return {
      id: session.server + ":" + chat.shared.roomId,
      root: context.dir!,
      validate: () => this.context(chat.projectId),
      request: async (path: string, method = "GET", body?: unknown) => {
        const current = await this.session(chat);
        return current.request(
          `/v1/rooms/${chat.shared!.roomId}/workspace${path}`,
          method,
          body,
        );
      },
    };
  }
  async invite(chat: ProjectChat) {
    const s = await this.session(chat),
      c = await this.context(chat.projectId);
    const invite = await s.request<{ code: string; expiresAt: number }>(
      "/v1/invites",
      "POST",
      {},
    );
    return {
      url: roomInvitation(
        { server: s.server, projectId: s.projectId, secret: invite.code },
        {
          project: { ...c.ref, server: c.client.account.server },
          ...(chat.scope.kind === "pr"
            ? { number: chat.scope.ref.number }
            : {}),
          conversation: chat.shared!.roomId,
        },
      ),
      expiresAt: invite.expiresAt,
    };
  }
  async join(projectId: string, url: string) {
    const invitation = parseRoomInvitation(url),
      c = await this.context(projectId);
    if (
      !invitation.project ||
      invitation.project.server !== c.client.account.server ||
      invitation.project.owner !== c.ref.owner ||
      invitation.project.name !== c.ref.name
    )
      throw new Error(
        "Choose the matching Gitea project and local clone before joining.",
      );
    await this.rooms.allowAccess(c, invitation.server);
    await this.rooms.connectProject(c, invitation);
    return invitation.conversation;
  }
}
