import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { DraftChange, HeldSend } from "../../shared/drafts";
import type { ProjectChatSend } from "../../shared/projects";
import { RemoteBridge, type RemoteHost } from "../remote/bridge";
import { DraftStore, Drafts } from ".";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-drafts-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const chatId = randomUUID();
const send = (body: string): ProjectChatSend => ({
  id: randomUUID(),
  body,
  provider: "codex",
  choice: { model: "", reasoningEffort: "", fast: false },
  runtimeMode: "auto",
  interactionMode: "default",
});

async function setup(deliver?: (request: HeldSend) => boolean) {
  const store = new DraftStore(join(dir, "drafts.json"));
  await store.load();
  const changes: DraftChange[] = [];
  const drafts = new Drafts(store, {
    changed: (change) => changes.push(change),
    ...(deliver ? { deliver } : {}),
  });
  const dispatched: { method: string; args: unknown[] }[] = [];
  const bridge = new RemoteBridge(
    {
      projects: async () => [],
      chats: () => [],
      dispatch: async (method: string, args: unknown[]) => {
        dispatched.push({ method, args });
      },
      name: () => "Studio",
      drafts,
    } as unknown as RemoteHost,
    () => {},
  );
  return { store, drafts, changes, bridge, dispatched };
}

it("keeps drafts across a restart, revs going on from where they were", async () => {
  const { store, drafts } = await setup();
  drafts.write(
    { key: chatId, text: "Fix the login", base: 0, at: 1 },
    "desktop",
  );
  drafts.write(
    { key: chatId, text: "Fix the login page", base: 1, at: 2 },
    "desktop",
  );
  await store.flush();
  const again = new DraftStore(join(dir, "drafts.json"));
  await again.load();
  expect(again.list()).toMatchObject([
    { key: chatId, text: "Fix the login page", rev: 2 },
  ]);
  expect(
    again.write({ key: "other", text: "Hi", base: 0, at: 3 }, "desktop")?.draft
      ?.rev,
  ).toBe(3);
});

it("drops a saved draft that doesn't read and keeps the rest", async () => {
  await writeFile(
    join(dir, "drafts.json"),
    JSON.stringify({
      rev: 4,
      drafts: [
        {
          key: "../../etc",
          text: "x",
          rev: 1,
          at: 1,
          by: "desktop",
          origin: "desktop",
        },
        {
          key: chatId,
          text: "Kept",
          rev: 4,
          at: 1,
          by: "desktop",
          origin: "desktop",
        },
      ],
    }),
  );
  const store = new DraftStore(join(dir, "drafts.json"));
  await store.load();
  expect(store.list().map((d) => d.text)).toEqual(["Kept"]);
});

it("names the phone that wrote a draft, and tells everyone", async () => {
  const { bridge, changes } = await setup();
  const after = await bridge.handle(
    "saveDraft",
    [{ key: chatId, text: "From the couch", base: 0, at: 1 }],
    "phone-1",
  );
  expect(after).toMatchObject({ origin: "phone:phone-1", by: "phone:phone-1" });
  expect(changes).toHaveLength(1);
  const overview = (await bridge.handle("overview", [])) as {
    drafts: unknown[];
  };
  expect(overview.drafts).toHaveLength(1);
});

it("sends a draft holding nothing of the desktop's as any send", async () => {
  const { bridge, drafts, dispatched } = await setup(() => true);
  drafts.write({ key: chatId, text: "Plain", base: 0, at: 1 }, "desktop");
  const message = send("Plain");
  await expect(
    bridge.handle("sendDraft", [chatId, chatId, message]),
  ).resolves.toEqual({ chatId });
  expect(dispatched).toEqual([
    { method: "sendProjectChat", args: [chatId, message] },
  ]);
});

it("sends one with the desktop's screenshot through its page, then drops the draft", async () => {
  const requests: HeldSend[] = [];
  const { bridge, drafts, dispatched, changes } = await setup((r) => {
    requests.push(r);
    return true;
  });
  drafts.write(
    {
      key: chatId,
      text: "Look at [Image #1]",
      base: 0,
      at: 1,
      extras: { screenshots: [1] },
    },
    "desktop",
  );
  const message = send("Look at [Image #1]");
  const sending = bridge.handle("sendDraft", [chatId, chatId, message]);
  await new Promise((r) => setTimeout(r));
  expect(requests).toMatchObject([{ key: chatId, chatId, send: message }]);
  expect(drafts.waitingSends()).toHaveLength(1);
  drafts.finishSend(requests[0]!.id, { chatId });
  await expect(sending).resolves.toEqual({ chatId });
  expect(dispatched).toEqual([]);
  expect(drafts.list()).toEqual([]);
  expect(changes.at(-1)).toEqual({ key: chatId, draft: null, sent: true });
});

it("keeps the draft when the desktop's page couldn't send it", async () => {
  const requests: HeldSend[] = [];
  const { bridge, drafts } = await setup((r) => (requests.push(r), true));
  drafts.write(
    { key: chatId, text: "Look", base: 0, at: 1, extras: { codeRefs: 1 } },
    "desktop",
  );
  const sending = bridge.handle("sendDraft", [chatId, chatId, send("Look")]);
  await new Promise((r) => setTimeout(r));
  drafts.finishSend(requests[0]!.id, { error: "The agent isn't set up." });
  await expect(sending).rejects.toThrow("The agent isn't set up.");
  expect(drafts.list()).toHaveLength(1);
});

it("hands a waiting send to the next page when the one that had it goes", async () => {
  const requests: HeldSend[] = [];
  const { drafts } = await setup((r) => (requests.push(r), true));
  drafts.write(
    { key: chatId, text: "x", base: 0, at: 1, extras: { selection: true } },
    "desktop",
  );
  void drafts.sendHeld(chatId, chatId, send("x")).catch(() => {});
  drafts.redeliver();
  expect(requests.map((r) => r.id)).toEqual([requests[0]!.id, requests[0]!.id]);
});

it("says to open Relay when no page can take a send", async () => {
  const { drafts } = await setup(() => false);
  drafts.write(
    { key: chatId, text: "x", base: 0, at: 1, extras: { selection: true } },
    "desktop",
  );
  await expect(drafts.sendHeld(chatId, chatId, send("x"))).rejects.toThrow(
    "Open Relay on the computer",
  );
});

it("won't start a new thread from a draft the desktop no longer holds part of", async () => {
  const { bridge, drafts } = await setup(() => true);
  drafts.write({ key: "new:p1:abc", text: "Start", base: 0, at: 1 }, "phone:p");
  await expect(
    bridge.handle("sendDraft", ["new:p1:abc", null, send("Start")]),
  ).rejects.toThrow("This draft changed on the computer");
});

it("shares a new draft's pending send across retries and returns its receipt after the draft is gone", async () => {
  const requests: HeldSend[] = [];
  const { bridge, drafts, store } = await setup(
    (r) => (requests.push(r), true),
  );
  const key = "new:p1:abc";
  const message = send("Fix this");
  drafts.write(
    { key, text: message.body, base: 0, at: 1, extras: { codeRefs: 1 } },
    "desktop",
  );
  const first = bridge.handle("sendDraft", [key, null, message]);
  const retried = bridge.handle("sendDraft", [key, null, message]);
  expect(requests).toHaveLength(1);
  expect(drafts.waitingSends()).toHaveLength(1);
  const result = { chatId: randomUUID() };
  drafts.finishSend(requests[0]!.id, result);
  await expect(Promise.all([first, retried])).resolves.toEqual([
    result,
    result,
  ]);
  expect(drafts.holds(key)).toBe(false);
  // The RPC reply was lost; the phone still only knows the original draft key.
  await expect(
    bridge.handle("sendDraft", [key, null, message]),
  ).resolves.toEqual(result);
  expect(requests).toHaveLength(1);
  await store.flush();
});

it("lets a refused new-draft send retry with the same send id", async () => {
  const requests: HeldSend[] = [];
  const { bridge, drafts, store } = await setup(
    (r) => (requests.push(r), true),
  );
  const key = "new:p1:abc";
  const message = send("Fix this");
  drafts.write(
    { key, text: message.body, base: 0, at: 1, extras: { codeRefs: 1 } },
    "desktop",
  );
  const first = bridge.handle("sendDraft", [key, null, message]);
  drafts.finishSend(requests[0]!.id, { error: "The agent isn't set up." });
  await expect(first).rejects.toThrow("The agent isn't set up.");
  const retried = bridge.handle("sendDraft", [key, null, message]);
  expect(requests).toHaveLength(2);
  drafts.finishSend(requests[1]!.id, { chatId });
  await expect(retried).resolves.toEqual({ chatId });
  await store.flush();
});

it("keeps new-draft send receipts separate for different draft keys", async () => {
  const requests: HeldSend[] = [];
  const { bridge, drafts, store } = await setup(
    (r) => (requests.push(r), true),
  );
  const message = send("Fix this");
  for (const key of ["new:p1:abc", "new:p1:def"])
    drafts.write(
      { key, text: message.body, base: 0, at: 1, extras: { codeRefs: 1 } },
      "desktop",
    );
  const first = bridge.handle("sendDraft", ["new:p1:abc", null, message]);
  const other = bridge.handle("sendDraft", ["new:p1:def", null, message]);
  expect(requests).toHaveLength(2);
  const results = [{ chatId: randomUUID() }, { chatId: randomUUID() }];
  requests.forEach((request, i) => drafts.finishSend(request.id, results[i]!));
  await expect(Promise.all([first, other])).resolves.toEqual(results);
  await store.flush();
});

it("writes the file only after the typing pauses", async () => {
  const { store, drafts } = await setup();
  drafts.write({ key: chatId, text: "a", base: 0, at: 1 }, "desktop");
  await expect(readFile(join(dir, "drafts.json"), "utf8")).rejects.toThrow();
  await store.flush();
  expect(
    JSON.parse(await readFile(join(dir, "drafts.json"), "utf8")).drafts,
  ).toHaveLength(1);
});

it("keeps what a phone typed while its held send was going out", async () => {
  const requests: HeldSend[] = [];
  const { drafts } = await setup((r) => (requests.push(r), true));
  drafts.write(
    { key: chatId, text: "Look", base: 0, at: 1, extras: { codeRefs: 1 } },
    "desktop",
  );
  const sending = drafts.sendHeld(chatId, chatId, send("Look"));
  // The next message, typed and saved before the computer finished sending.
  drafts.write({ key: chatId, text: "And then", base: 1, at: 2 }, "phone:p");
  drafts.finishSend(requests[0]!.id, { chatId });
  await sending;
  expect(drafts.list().map((d) => [d.text, d.extras])).toEqual([["And then", undefined]]);
});
