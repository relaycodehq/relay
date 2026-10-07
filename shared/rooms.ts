import { z } from "zod";
import {
  agentMentionPattern,
  agents,
  type AgentProvider,
  type HelperProvider,
} from "./agents";
import {
  filePathSchema,
  refSchema,
  shaSchema,
  sideSchema,
  normalizeServer,
} from "./validation";
import { aiSettingsSchema } from "./settings";
import type { PullRef } from "./types";

export const roomServerSchema = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    try {
      const u = new URL(value);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(u.pathname) ||
        !(
          u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
        )
      )
        throw new Error();
      return u.origin + u.pathname.replace(/\/$/, "");
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an HTTPS room server, or HTTP on localhost.",
      });
      return z.NEVER;
    }
  });
export const idSchema = z.string().uuid();
export const secretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const projectSchema = refSchema
  .omit({ number: true })
  .extend({ server: z.url().max(2048) })
  .strict();
const contextSchema = z
  .object({
    head: shaSchema,
    base: shaSchema,
    path: filePathSchema.optional(),
    side: sideSchema.optional(),
    start: z.number().int().min(1).max(2_000_000).optional(),
    end: z.number().int().min(1).max(2_000_000).optional(),
    excerpt: z.string().max(60000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.start === undefined ||
      (!!v.path &&
        !!v.side &&
        v.end !== undefined &&
        v.end >= v.start &&
        v.end - v.start < 200),
  );
const roomSchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  title: z.string().max(500),
});
export const presenceSchema = z
  .object({
    path: filePathSchema.nullable(),
    head: shaSchema,
    viewed: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();
export type RoomContext = z.infer<typeof contextSchema>;
export type RoomProject = z.infer<typeof projectSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Presence = z.infer<typeof presenceSchema> & {
  userId: string;
  name: string;
  at: number;
};
/** Agents that answer in shared rooms: those that run Relay's helper jobs. */
export type Provider = HelperProvider;

/** Only an explicit leading mention invokes an agent. Quoted/code mentions are ordinary chat. */
export function agentMention(
  text: string,
): { provider: AgentProvider; question: string } | null {
  const trimmed = text.trim();
  const m = agentMentionPattern.exec(trimmed);
  return m
    ? {
        provider: m[1].toLowerCase() as AgentProvider,
        question: trimmed.slice(m[0].length).trim(),
      }
    : null;
}
/** A mention of an agent that answers in shared rooms. */
export function roomMention(
  text: string,
): { provider: Provider; question: string } | null {
  const mention = agentMention(text);
  return mention && agents[mention.provider].helper
    ? (mention as { provider: Provider; question: string })
    : null;
}
export const messageInputSchema = z
  .object({
    id: idSchema,
    body: z.string().trim().min(1).max(16000),
    parentId: idSchema.nullable(),
    context: contextSchema,
  })
  .strict();
export type MessageInput = z.infer<typeof messageInputSchema>;
export interface RoomMessage extends MessageInput {
  roomId: string;
  authorId: string;
  author: string;
  createdAt: number;
  order: number;
  seq: number;
  kind: "human" | "agent";
  provider: Provider | null;
  requestId: string | null;
  status: "sent" | "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  model: string | null;
}
export interface Member {
  id: string;
  name: string;
  owner: boolean;
}
export interface RoomConnection {
  server: string;
  projectId: string;
  project: RoomProject;
  member: Member;
  token: string;
}
type PublicConnection = Omit<RoomConnection, "token"> & {
  persistent: boolean;
};
export const connectionSchema = z.object({
  server: roomServerSchema,
  projectId: idSchema,
  project: projectSchema,
  member: z.object({
    id: idSchema,
    name: z.string().min(1).max(80),
    owner: z.boolean(),
  }),
  token: secretSchema,
});
export const connectRoomSchema = z
  .object({
    server: roomServerSchema,
    secret: secretSchema,
    projectId: idSchema.optional(),
  })
  .strict();
export type ConnectRoom = z.infer<typeof connectRoomSchema>;
export const roomHostingSchema = connectRoomSchema.omit({ projectId: true });
export type RoomHosting = z.infer<typeof roomHostingSchema>;
export const roomProtocol = "relay-room";
const invitationTargetSchema = z.object({
  project: projectSchema.extend({
    server: z.string().transform(normalizeServer),
  }),
  number: refSchema.shape.number,
});
export type RoomInvitation = Required<ConnectRoom> &
  Partial<z.infer<typeof invitationTargetSchema>>;
export function roomInvitation(
  input: Required<ConnectRoom>,
  target?: z.infer<typeof invitationTargetSchema>,
): string {
  const { server, projectId, secret } = connectRoomSchema
    .required()
    .parse(input);
  const params = new URLSearchParams({ join: `${projectId}.${secret}` });
  if (target) {
    const value = invitationTargetSchema.parse(target);
    params.set("project", JSON.stringify(value.project));
    params.set("pr", String(value.number));
  }
  return `${server}/#${params}`;
}
export function parseRoomInvitation(value: string): RoomInvitation {
  try {
    if (value.length > 16384) throw new Error();
    const url = new URL(value.trim());
    const params = new URLSearchParams(url.hash.slice(1));
    for (const key of params.keys()) {
      if (
        !["join", "project", "pr"].includes(key) ||
        params.getAll(key).length !== 1
      )
        throw new Error();
    }
    const match = /^([0-9a-f-]+)\.([A-Za-z0-9_-]{43})$/i.exec(
      params.get("join") ?? "",
    );
    if (!match) throw new Error();
    let server: string;
    if (url.protocol === roomProtocol + ":") {
      if (
        url.hostname !== "join" ||
        url.username ||
        url.password ||
        url.port ||
        !["", "/"].includes(url.pathname) ||
        [...url.searchParams.keys()].join() !== "server"
      )
        throw new Error();
      server = url.searchParams.get("server") ?? "";
    } else {
      url.hash = "";
      server = url.href;
    }
    url.hash = "";
    const input = connectRoomSchema.required().parse({
      server,
      projectId: match[1],
      secret: match[2],
    });
    const target =
      params.has("project") || params.has("pr")
        ? invitationTargetSchema.parse({
            project: JSON.parse(params.get("project") ?? "null"),
            number: Number(params.get("pr")),
          })
        : {};
    return { ...input, ...target };
  } catch {
    throw new Error(
      "Paste the full project invitation link from an HTTPS room server.",
    );
  }
}
export function roomAppUrl(value: string): string {
  const invitation = parseRoomInvitation(value);
  const link = roomInvitation(
    {
      server: invitation.server,
      projectId: invitation.projectId,
      secret: invitation.secret,
    },
    invitation.project && invitation.number
      ? { project: invitation.project, number: invitation.number }
      : undefined,
  );
  return `${roomProtocol}://join?server=${encodeURIComponent(invitation.server)}${new URL(link).hash}`;
}
/**
 * Sends kept in a room draft from before `choice` carried every agent's pick
 * hold Claude's in a `claude` field; a retry folds it into `choice`.
 */
const legacyClaudePick = (value: unknown) => {
  if (!value || typeof value !== "object" || !("claude" in value)) return value;
  const { claude, ...send } = value as Record<string, unknown> & {
    claude?: { model?: string; effort?: string };
    body?: string;
  };
  return roomMention(String(send.body ?? ""))?.provider === "claude"
    ? {
        ...send,
        choice: {
          model: claude?.model ?? "",
          reasoningEffort: claude?.effort ?? "",
          fast: false,
        },
      }
    : send;
};
export const sendRoomSchema = z.preprocess(
  legacyClaudePick,
  messageInputSchema
    .omit({ context: true })
    .extend({
      context: contextSchema.safeExtend({ excerpt: z.never().optional() }),
      /** The asked agent's model and effort. */
      choice: aiSettingsSchema.shape.questions,
    })
    .strict(),
);
export type SendRoom = z.infer<typeof sendRoomSchema>;
export interface RoomPage {
  messages: RoomMessage[];
  cursor: number;
  more: boolean;
  presence: Presence[];
}
export interface RoomState {
  connection: PublicConnection | null;
  room: Room | null;
}
export interface RoomApi {
  roomAccessInfo(ref: PullRef): Promise<{ server: string | null }>;
  allowRoomAccess(ref: PullRef, server: string): Promise<void>;
  roomHosting(): Promise<{ server: string | null }>;
  saveRoomHosting(input: RoomHosting | null): Promise<void>;
  roomAcceptInvitation(url: string): Promise<{
    ref: PullRef;
    state: RoomState;
  }>;
  roomConnect(ref: PullRef, input: ConnectRoom): Promise<RoomState>;
  roomState(ref: PullRef): Promise<RoomState>;
  roomDisconnect(ref: PullRef): Promise<void>;
  roomPoll(ref: PullRef, cursor: number, before?: number): Promise<RoomPage>;
  roomSend(ref: PullRef, input: SendRoom): Promise<void>;
  roomCancel(ref: PullRef, id: string): Promise<void>;
  roomPresence(
    ref: PullRef,
    presence: z.infer<typeof presenceSchema> | null,
  ): Promise<void>;
  roomInvite(ref: PullRef): Promise<{ code: string; expiresAt: number }>;
  roomMembers(ref: PullRef): Promise<Member[]>;
  roomRevoke(ref: PullRef, memberId: string): Promise<void>;
}
