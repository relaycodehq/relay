import { randomUUID } from "node:crypto";
import { handoffChunk } from "../../shared/handoff";
import type { RemoteClient } from "../../shared/remote-client";
import { readPaste, writePasteChunk } from "../drafts";

const maxPasteBytes = 200 * 1024 * 1024;
// A live message arrives repeatedly as it streams; its attachment needs copying only once.
const sent = new WeakMap<RemoteClient, Map<string, Promise<string | null>>>();
const received = new WeakMap<
  RemoteClient,
  Map<string, Promise<string | null>>
>();

async function rewrite<T extends { body: string }>(
  messages: T[],
  replace: (path: string, n: number) => Promise<string | null>,
): Promise<T[]> {
  const paths = new Map<string, string>();
  const out: T[] = [];
  for (const message of messages) {
    for (const match of message.body.matchAll(
      /`([^`\r\n]+[\\/]pasted-text(?:-([1-9]\d{0,2}))?\.txt)`/g,
    )) {
      const path = match[1];
      if (!paths.has(path))
        paths.set(path, (await replace(path, Number(match[2] ?? 1))) ?? path);
    }
    const body = message.body.replace(
      /`([^`\r\n]+[\\/]pasted-text(?:-\d+)?\.txt)`/g,
      (whole, path: string) =>
        paths.has(path) ? `\`${paths.get(path)}\`` : whole,
    );
    out.push(body === message.body ? message : { ...message, body });
  }
  return out;
}

/** Finish copying attachments before sending a message or replaying an offline send. */
export function sendPastes<T extends { body: string }>(
  messages: T[],
  client: RemoteClient,
  supported: boolean,
) {
  let paths = sent.get(client);
  if (!paths) sent.set(client, (paths = new Map()));
  return rewrite(messages, (path, n) => {
    const known = paths.get(path);
    if (known) return known;
    const copying = (async () => {
      let data = await readPaste(path, 0, handoffChunk);
      if (data === null) return null;
      if (!supported)
        throw new Error(
          "Update Relay on the other computer before sending pasted files.",
        );
      const id = randomUUID();
      let offset = 0,
        there: string;
      do {
        const size = Buffer.byteLength(data, "base64");
        if (offset + size > maxPasteBytes)
          throw new Error("This paste is too large.");
        there = await client.call("uploadPaste", id, n, offset, data);
        offset += size;
        if (size < handoffChunk) break;
        data = (await readPaste(path, offset, handoffChunk))!;
      } while (true);
      let back = received.get(client);
      if (!back) received.set(client, (back = new Map()));
      back.set(there, Promise.resolve(path));
      return there;
    })().catch((error: unknown) => {
      paths.delete(path);
      throw error;
    });
    paths.set(path, copying);
    return copying;
  });
}

/** Mirrors and returned threads must name files that exist on this computer. */
export function receivePastes<T extends { body: string }>(
  messages: T[],
  client: RemoteClient,
  supported: boolean,
) {
  if (!supported) return Promise.resolve(messages);
  let paths = received.get(client);
  if (!paths) received.set(client, (paths = new Map()));
  return rewrite(messages, (path, n) => {
    const known = paths.get(path);
    if (known) return known;
    const copying = (async () => {
      const id = randomUUID();
      let offset = 0,
        here: string;
      do {
        const data = await client.call("downloadPaste", path, offset);
        if (data === null) {
          if (offset) throw new Error("The paste download ended early.");
          return null;
        }
        const bytes = Buffer.from(data, "base64");
        if (
          bytes.length > handoffChunk ||
          offset + bytes.length > maxPasteBytes
        )
          throw new Error("This paste is too large.");
        here = await writePasteChunk(id, n, offset, bytes);
        offset += bytes.length;
        if (bytes.length < handoffChunk) break;
      } while (true);
      let back = sent.get(client);
      if (!back) sent.set(client, (back = new Map()));
      back.set(here, Promise.resolve(path));
      return here;
    })().catch((error: unknown) => {
      paths.delete(path);
      throw error;
    });
    paths.set(path, copying);
    return copying;
  });
}
