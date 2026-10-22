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
import {
  pastesBridge,
  skillsBridge,
  type HandoffPart,
} from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import { sentAgent } from "../../shared/recipient";
import type { ComputerInfos } from "./computer-infos";
import { receivePastes, sendPastes } from "./pastes";

/** The agent and settings a thread's next turn there runs with: its last send's. */
export const settingsOf = (
  input: NonNullable<ProjectChat["lastInput"]>,
): HandoffThread["settings"] => ({
  provider: sentAgent(input),
  choice: input.choice,
  runtimeMode: input.runtimeMode,
  interactionMode: input.interactionMode,
  ...(input.contextWindow ? { contextWindow: input.contextWindow } : {}),
});

/** A thread's messages as the other computer answers them: full ones, or the ids of those already here. */
export const readMirrored = (messages: unknown) =>
  z.array(z.union([z.string(), handoffMessageSchema])).parse(messages) as (
    ChatMessage | string
  )[];

/** A send as a computer this old takes it: one before `skillsBridge` refuses its pills' skills. */
export async function sendFor(
  infos: ComputerInfos,
  computerId: string,
  client: RemoteClient,
  send: ProjectChatSend,
) {
  const [carried] = await sendPastes(
    [send],
    client,
    async () =>
      ((await infos.get(computerId, client))?.bridge ?? 0) >= pastesBridge,
  );
  if (!send.skills) return carried!;
  const info = await infos.get(computerId, client).catch(() => null);
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
  return receivePastes(messages, client, (info?.bridge ?? 0) >= pastesBridge);
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
