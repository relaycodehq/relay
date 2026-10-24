import { randomUUID } from "node:crypto";
import { handoffChunk } from "../../shared/handoff";
import type { RemoteClient } from "../../shared/remote-client";
import {
  fileUploadChunk,
  filesBridge,
  pastesBridge,
  type UploadedFile,
} from "../../shared/remote";
import {
  pasteSize,
  readPaste,
  receiveFileChunk,
  writePasteChunk,
} from "../drafts";

const maxPasteBytes = 200 * 1024 * 1024;
// A live message arrives repeatedly as it streams; its attachment needs copying only once.
const sent = new WeakMap<RemoteClient, Map<string, Promise<string | null>>>();
const received = new WeakMap<
  RemoteClient,
  Map<string, Promise<string | null>>
>();

/** A saved paste is its message's nth; any other file in the paste folder a phone attached. */
type Saved = { n: number } | { name: string };

// What Relay saves among its pastes sits alone in a folder named by a UUID.
const savedPath = /`([^`\r\n]+[\\/][0-9a-f-]{36}[\\/]([^`\\/\r\n]+))`/g;
const pasteName = /^pasted-text(?:-([1-9]\d{0,2}))?\.txt$/;

async function rewrite<T extends { body: string }>(
  messages: T[],
  replace: (path: string, saved: Saved) => Promise<string | null>,
): Promise<T[]> {
  const paths = new Map<string, string>();
  const out: T[] = [];
  for (const message of messages) {
    for (const [, path, name] of message.body.matchAll(savedPath)) {
      if (paths.has(path!)) continue;
      const paste = name!.match(pasteName);
      const saved = paste ? { n: Number(paste[1] ?? 1) } : { name: name! };
      paths.set(path!, (await replace(path!, saved)) ?? path!);
    }
    const body = message.body.replace(savedPath, (whole, path: string) =>
      paths.has(path) ? `\`${paths.get(path)}\`` : whole,
    );
    out.push(body === message.body ? message : { ...message, body });
  }
  return out;
}

async function uploadPaste(
  client: RemoteClient,
  path: string,
  n: number,
  first: string,
) {
  const id = randomUUID();
  let data = first,
    offset = 0,
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
  return there;
}

async function uploadFile(
  client: RemoteClient,
  path: string,
  name: string,
  size: number,
) {
  const id = randomUUID();
  let offset = 0;
  do {
    const data = (await readPaste(path, offset, fileUploadChunk))!;
    const there: UploadedFile = await client.call(
      "uploadFile",
      id,
      name,
      size,
      offset,
      data,
    );
    if (there.path) return there.path;
    if (there.received <= offset)
      throw new Error("The other computer stopped taking the file.");
    offset = there.received;
  } while (true);
}

/** Finish copying attachments before sending a message or replaying an offline send. */
export function sendPastes<T extends { body: string }>(
  messages: T[],
  client: RemoteClient,
  /** The other computer's bridge; asked only once something needs copying, so a message without any never waits on it. */
  bridge: number | (() => Promise<number>),
) {
  let paths = sent.get(client);
  if (!paths) sent.set(client, (paths = new Map()));
  return rewrite(messages, (path, saved) => {
    const known = paths.get(path);
    if (known) return known;
    const copying = (async () => {
      const size = await pasteSize(path);
      if (size === null) return null;
      const theirs = typeof bridge === "number" ? bridge : await bridge();
      let there: string;
      if ("n" in saved) {
        if (theirs < pastesBridge)
          throw new Error(
            "Update Relay on the other computer before sending pasted files.",
          );
        if (size > maxPasteBytes) throw new Error("This paste is too large.");
        const first = await readPaste(path, 0, handoffChunk);
        if (first === null) return null;
        there = await uploadPaste(client, path, saved.n, first);
      } else {
        if (theirs < filesBridge)
          throw new Error(
            "Update Relay on the other computer before sending attached files.",
          );
        there = await uploadFile(client, path, saved.name, size);
      }
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
  bridge: number,
) {
  if (bridge < pastesBridge) return Promise.resolve(messages);
  let paths = received.get(client);
  if (!paths) received.set(client, (paths = new Map()));
  return rewrite(messages, (path, saved) => {
    const known = paths.get(path);
    if (known) return known;
    // An older computer only gives pastes; any other file stays where it is.
    if (!("n" in saved) && bridge < filesBridge) return Promise.resolve(null);
    const copying = (async () => {
      const id = randomUUID();
      let offset = 0,
        here: string | undefined;
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
        const last = bytes.length < handoffChunk;
        here =
          "n" in saved
            ? await writePasteChunk(id, saved.n, offset, bytes)
            : (await receiveFileChunk(id, saved.name, offset, bytes, last))
                .path;
        offset += bytes.length;
        if (last) break;
      } while (true);
      if (!here) throw new Error("The file download ended early.");
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
