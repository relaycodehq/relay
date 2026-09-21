import { z } from "zod";
import { filePathSchema, refSchema, shaSchema, sideSchema } from "./validation";
import { aiSettingsSchema } from "./settings";

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
export const contextSchema = z
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
export const roomSchema = z.object({
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
export type Provider = "codex" | "claude";

/** Only an explicit leading mention invokes an agent. Quoted/code mentions are ordinary chat. */
export function agentMention(
  text: string,
): { provider: Provider; question: string } | null {
  const m = /^@(codex|claude)(?=\s|$)\s*([\s\S]*)$/i.exec(text.trim());
  return m
    ? { provider: m[1].toLowerCase() as Provider, question: m[2].trim() }
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
export type PublicConnection = Omit<RoomConnection, "token"> & {
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
export function roomInvitation(input: Required<ConnectRoom>): string {
  const { server, projectId, secret } = connectRoomSchema
    .required()
    .parse(input);
  return `${server}/#join=${projectId}.${secret}`;
}
export function parseRoomInvitation(value: string): Required<ConnectRoom> {
  try {
    const url = new URL(value.trim());
    const match = /^#join=([0-9a-f-]+)\.([A-Za-z0-9_-]{43})$/i.exec(url.hash);
    if (!match) throw new Error();
    url.hash = "";
    return connectRoomSchema.required().parse({
      server: url.href,
      projectId: match[1],
      secret: match[2],
    });
  } catch {
    throw new Error(
      "Paste the full project invitation link from an HTTPS room server.",
    );
  }
}
export const sendRoomSchema = messageInputSchema
  .omit({ context: true })
  .extend({
    context: contextSchema.safeExtend({ excerpt: z.never().optional() }),
    choice: aiSettingsSchema.shape.questions,
    claude: z
      .object({
        model: z
          .string()
          .max(160)
          .regex(/^[a-zA-Z0-9._:/-]*$/),
        effort: z.enum(["", "low", "medium", "high", "xhigh", "max"]),
      })
      .strict()
      .default({ model: "", effort: "" }),
  })
  .strict();
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
  roomConnect(
    ref: { owner: string; name: string; number: number },
    input: ConnectRoom,
  ): Promise<RoomState>;
  roomState(ref: {
    owner: string;
    name: string;
    number: number;
  }): Promise<RoomState>;
  roomDisconnect(ref: {
    owner: string;
    name: string;
    number: number;
  }): Promise<void>;
  roomPoll(
    ref: { owner: string; name: string; number: number },
    cursor: number,
    before?: number,
  ): Promise<RoomPage>;
  roomSend(
    ref: { owner: string; name: string; number: number },
    input: SendRoom,
  ): Promise<void>;
  roomCancel(
    ref: { owner: string; name: string; number: number },
    id: string,
  ): Promise<void>;
  roomPresence(
    ref: { owner: string; name: string; number: number },
    presence: z.infer<typeof presenceSchema> | null,
  ): Promise<void>;
  roomInvite(ref: {
    owner: string;
    name: string;
    number: number;
  }): Promise<{ code: string; expiresAt: number }>;
  roomMembers(ref: {
    owner: string;
    name: string;
    number: number;
  }): Promise<Member[]>;
  roomRevoke(
    ref: { owner: string; name: string; number: number },
    memberId: string,
  ): Promise<void>;
}
