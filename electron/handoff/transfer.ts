import { open } from "node:fs/promises";
import { z } from "zod";
import {
  handoffChunk,
  handoffMessageSchema,
  handoffMessagesSchema,
  type HandoffThread,
} from "../../shared/handoff";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import type { RuntimeMode } from "../../shared/agent-modes";
import {
  readOnlyModeBridge,
  skillsBridge,
  type HandoffPart,
} from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import { sentAgent } from "../../shared/recipient";
import type { ComputerInfos } from "./computer-infos";
import { keepYourFiles, receivePastes, sendPastes } from "./pastes";

/** The computer a thread or a send goes to, as far as what it takes. */
type There = { name: string; bridge: number };

/**
 * A computer before `readOnlyModeBridge` refuses Read only, and any mode it
 * runs instead could change files: the user updates it or picks another mode.
 */
export function refuseReadOnlyOnOlder(
  mode: RuntimeMode,
  there: There,
  doing: string,
) {
  if (mode === "read-only" && there.bridge < readOnlyModeBridge)
    throw new Error(`Update Relay on ${there.name} to ${doing}.`);
}

/** The agent and settings a thread's next turn there runs with: its last send's. */
export function settingsOf(
  input: NonNullable<ProjectChat["lastInput"]>,
  there: There,
): HandoffThread["settings"] {
  refuseReadOnlyOnOlder(
    input.runtimeMode,
    there,
    "hand off a Read only thread",
  );
  return {
    provider: sentAgent(input),
    choice: input.choice,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.contextWindow ? { contextWindow: input.contextWindow } : {}),
  };
}

/**
 * The send a thread nothing answered yet starts with on the computer it went
 * to: its first message as it was sent, screenshots included.
 */
export async function firstSendOf(
  chat: ProjectChat,
  image: (imageId: string) => Promise<string>,
): Promise<ProjectChatSend> {
  const first = chat.messages.find((m) => m.role === "user" && !m.parentId);
  const input = chat.lastInput;
  if (!first || !input)
    throw new Error("Send a first message to start the thread.");
  const images = await Promise.all(
    (first.images ?? []).map(async ({ id, name, mimeType, browser }) => ({
      name,
      mimeType,
      dataUrl: await image(id),
      ...(browser ? { browser } : {}),
    })),
  );
  return {
    ...input,
    id: first.id,
    body: first.body,
    ...(images.length ? { images } : {}),
  };
}

/** A thread's messages as the other computer answers them: full ones, or the ids of those already here. */
export const readMirrored = (messages: unknown) =>
  z.array(z.union([z.string(), handoffMessageSchema])).parse(messages) as (
    ChatMessage | string
  )[];

/**
 * A send as the computer takes it: with the files it names copied there,
 * and without its pills' skills on one before `skillsBridge`, which refuses them.
 * One before `readOnlyModeBridge` gets no Read only send at all.
 */
export async function sendFor(
  infos: ComputerInfos,
  computer: { id: string; name: string },
  client: RemoteClient,
  send: ProjectChatSend,
) {
  const bridge = async () =>
    (await infos.get(computer.id, client))?.bridge ?? 0;
  if (send.runtimeMode === "read-only")
    refuseReadOnlyOnOlder(
      send.runtimeMode,
      { name: computer.name, bridge: await bridge() },
      "send a Read only message there",
    );
  const [carried] = await sendPastes(
    await keepYourFiles([send]),
    client,
    bridge,
  );
  if (!send.skills) return carried!;
  const info = await infos.get(computer.id, client).catch(() => null);
  if ((info?.bridge ?? 0) >= skillsBridge) return carried!;
  const { skills: _, ...older } = carried!;
  return older;
}

export async function receivePastesFrom(
  infos: ComputerInfos,
  computerId: string,
  client: RemoteClient,
  messages: ChatMessage[],
) {
  const info = await infos.get(computerId, client);
  return receivePastes(messages, client, info?.bridge ?? 0);
}

/** The thread as it came back, or an error naming what's wrong, before anything of it is applied. */
export function readReturned(text: string, computer: string): ChatMessage[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${computer} sent the thread back unreadable.`);
  }
  const parsed = handoffMessagesSchema.safeParse(json);
  if (parsed.success) return parsed.data as ChatMessage[];
  const [issue] = parsed.error.issues;
  const [at, ...field] = issue!.path;
  const where =
    typeof at === "number"
      ? `message ${at + 1}${field.length ? `'s ${field.join(".")}` : ""}`
      : "the message list";
  throw new Error(
    `${computer} sent the thread back in a form this Relay can't read (${where}: ${issue!.message}). Nothing was changed here.`,
  );
}

export async function upload(
  client: RemoteClient,
  id: string,
  part: HandoffPart,
  file: string,
) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(handoffChunk);
    for (let offset = 0; ;) {
      const { bytesRead } = await handle.read(buffer, 0, handoffChunk, offset);
      if (!bytesRead && offset) return;
      await client.call(
        "handoffUpload",
        id,
        part,
        offset,
        buffer.subarray(0, bytesRead).toString("base64"),
      );
      offset += bytesRead;
      if (bytesRead < handoffChunk) return;
    }
  } finally {
    await handle.close();
  }
}

export async function download(
  client: RemoteClient,
  id: string,
  part: HandoffPart,
  size: number,
  file: string,
) {
  const handle = await open(file, "w", 0o600);
  try {
    for (let offset = 0; offset < size;) {
      const bytes = Buffer.from(
        await client.call("handoffDownload", id, part, offset),
        "base64",
      );
      if (!bytes.length) throw new Error("The download ended early.");
      await handle.write(bytes);
      offset += bytes.length;
    }
  } finally {
    await handle.close();
  }
}
