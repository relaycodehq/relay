import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteClient } from "../../shared/remote-client";
import { handoffChunk } from "../../shared/handoff";
import { savePaste, setPastesRoot } from "../drafts";
import { HandoffReceiver } from "./receiver";
import { receivePastes, sendPastes } from "./pastes";

let root: string;
let local: string;
let remote: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-paste-transfer-"));
  local = join(root, "local");
  remote = join(root, "remote");
  await Promise.all([mkdir(local), mkdir(remote)]);
  setPastesRoot(local);
});
afterEach(() => rm(root, { recursive: true, force: true }));

// Both services in one process: select the receiving desktop's data folder
// only while it handles the call. All calls in these tests are sequential.
function peer() {
  const receiver = new HandoffReceiver({} as never);
  const call = vi.fn(async (method: string, ...args: unknown[]) => {
    setPastesRoot(remote);
    try {
      return await receiver.handle(method as never, args, {
        id: "peer",
        name: "Peer",
      });
    } finally {
      setPastesRoot(local);
    }
  });
  return { client: { call } as unknown as RemoteClient, call };
}

it("carries a multi-chunk paste once, rewrites its paths, and mirrors it back to the original", async () => {
  const { client, call } = peer();
  const text = "é".repeat(handoffChunk);
  const path = await savePaste(text, 2);
  const messages = [
    { body: `Read \`${path}\` and \`${path}\``, id: "message" },
  ];
  const carried = await sendPastes(messages, client, true);
  const there = carried[0]!.body.match(/`([^`]+)`/)![1]!;
  expect(there.startsWith(remote)).toBe(true);
  expect(there.endsWith("pasted-text-2.txt")).toBe(true);
  expect(await readFile(there, "utf8")).toBe(text);
  expect(carried[0]).toEqual({
    body: `Read \`${there}\` and \`${there}\``,
    id: "message",
  });
  expect(messages[0]!.body).toContain(path);
  expect(
    call.mock.calls.filter(([method]) => method === "uploadPaste"),
  ).toHaveLength(3);
  await sendPastes(messages, client, true);
  expect(call).toHaveBeenCalledTimes(3);
  expect(await receivePastes(carried, client, true)).toEqual(messages);
  expect(call).toHaveBeenCalledTimes(3);
});

it("brings a paste made on the receiving computer home and reuses it on the next handoff", async () => {
  const { client, call } = peer();
  setPastesRoot(remote);
  const path = await savePaste("remote log\n".repeat(handoffChunk), 1);
  setPastesRoot(local);
  const messages = [{ body: `Investigate \`${path}\`` }];
  const arrived = await receivePastes(messages, client, true);
  const here = arrived[0]!.body.match(/`([^`]+)`/)![1]!;
  expect(here.startsWith(local)).toBe(true);
  expect(await readFile(here, "utf8")).toBe(await readFile(path, "utf8"));
  expect(call.mock.calls.length).toBeGreaterThan(1);
  call.mockClear();
  expect(await sendPastes(arrived, client, true)).toEqual(messages);
  expect(call).not.toHaveBeenCalled();
});

it("leaves ordinary files alone and refuses to lose a saved paste on an older desktop", async () => {
  const { client, call } = peer();
  const outside = join(root, randomUUID());
  await mkdir(outside);
  const ordinary = join(outside, "pasted-text.txt");
  await writeFile(ordinary, "not a Relay paste");
  const message = [{ body: `Read \`${ordinary}\` and \`/docs/notes.txt\`` }];
  expect(await sendPastes(message, client, false)).toEqual(message);
  expect(call).not.toHaveBeenCalled();
  expect(await client.call("downloadPaste", ordinary, 0)).toBeNull();
  const path = await savePaste("saved log", 1);
  await expect(
    sendPastes([{ body: `\`${path}\`` }], client, false),
  ).rejects.toThrow("Update Relay");
});

it("rejects paths escaping the paste folder, invalid uploads and chunks arriving out of order", async () => {
  const { client } = peer();
  const secret = join(root, "outside.txt");
  await writeFile(secret, "outside");
  const dir = join(remote, randomUUID());
  await mkdir(dir);
  const link = join(dir, "pasted-text.txt");
  await symlink(secret, link);
  await expect(client.call("downloadPaste", link, 0)).rejects.toThrow(
    "outside",
  );
  await expect(
    client.call("uploadPaste", "../escape", 1, 0, "AA=="),
  ).rejects.toThrow();
  const id = randomUUID();
  await client.call("uploadPaste", id, 1, 0, "YWJj");
  await expect(client.call("uploadPaste", id, 1, 4, "ZA==")).rejects.toThrow(
    "out of step",
  );
  const path = await client.call("uploadPaste", id, 1, 3, "ZA==");
  await client.call("uploadPaste", id, 1, 3, "ZA==");
  expect(await readFile(path, "utf8")).toBe("abcd");
  await expect(
    client.call("uploadPaste", id, 1, 200 * 1024 * 1024, "ZA=="),
  ).rejects.toThrow("too large");
});

it("retries a failed paste upload before sending its rewritten reference", async () => {
  const { client, call } = peer();
  const path = await savePaste("important log", 1);
  const messages = [{ body: `Read \`${path}\`` }];
  call.mockRejectedValueOnce(new Error("link lost"));
  await expect(sendPastes(messages, client, true)).rejects.toThrow("link lost");
  const carried = await sendPastes(messages, client, true);
  const remotePath = carried[0]!.body.match(/`([^`]+)`/)![1]!;
  expect(await readFile(remotePath, "utf8")).toBe("important log");
});

it("refuses an interrupted download and retries it instead of caching a broken reference", async () => {
  const { client, call } = peer();
  const path = `/other/${randomUUID()}/pasted-text.txt`;
  const messages = [{ body: `Read \`${path}\`` }];
  call.mockResolvedValueOnce(Buffer.alloc(handoffChunk, 65).toString("base64"));
  call.mockResolvedValueOnce(null);
  await expect(receivePastes(messages, client, true)).rejects.toThrow(
    "ended early",
  );
  call.mockResolvedValueOnce(Buffer.from("complete").toString("base64"));
  const arrived = await receivePastes(messages, client, true);
  const here = arrived[0]!.body.match(/`([^`]+)`/)![1]!;
  expect(await readFile(here, "utf8")).toBe("complete");
});
