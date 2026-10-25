import { expect, it } from "vitest";
import { lastComposerSettings } from "./composer";
import { sentSettingsOf, type ProjectChatSend } from "./send";
import type { ChatMessage } from "./messages";
import type { ProjectChat } from "./chat";

const send = (id: string, parentId?: string): ProjectChatSend => ({
  id,
  body: "@claude Work on this",
  provider: "claude",
  choice: { model: "opus", fast: true, reasoningEffort: "max" },
  contextWindow: "200k",
  runtimeMode: "auto",
  interactionMode: "plan",
  ...(parentId ? { parentId } : {}),
});

const user = (input: ProjectChatSend, created: number): ChatMessage => ({
  id: input.id,
  role: "user",
  body: input.body,
  provider: input.provider,
  status: "complete",
  version: 1,
  created,
  ...(input.parentId ? { parentId: input.parentId } : {}),
  ...(input.side ? { side: true } : {}),
  sentSettings: sentSettingsOf(input),
});

const chat = (messages: ChatMessage[], lastInput?: ProjectChatSend) =>
  ({ messages, lastInput }) as ProjectChat;

it("uses the exact launch settings of an older, unopened thread", () => {
  const input = send("launch");
  expect(lastComposerSettings(chat([], input))).toEqual({
    id: input.id,
    ...sentSettingsOf(input),
  });
});

it("keeps main, reply and /btw settings apart after another branch sends last", () => {
  const main = send("main");
  const reply = {
    ...send("reply", main.id),
    choice: { ...main.choice, reasoningEffort: "low" as const },
  };
  const side = {
    ...send("btw"),
    side: true as const,
    runtimeMode: "approval-required" as const,
  };
  const followup = send("btw-followup", side.id);
  const data = chat(
    [user(main, 1), user(reply, 2), user(side, 3), user(followup, 4)],
    reply,
  );
  expect(lastComposerSettings(data)).toEqual({
    id: main.id,
    ...sentSettingsOf(main),
  });
  expect(lastComposerSettings(data, main.id)).toEqual({
    id: reply.id,
    ...sentSettingsOf(reply),
  });
  expect(lastComposerSettings(data, side.id)).toEqual({
    id: followup.id,
    ...sentSettingsOf(followup),
  });
  expect(lastComposerSettings(chat([user(side, 3)], side))).toBeUndefined();
  expect(lastComposerSettings(chat([user(side, 3)], side), side.id)).toEqual({
    id: side.id,
    ...sentSettingsOf(side),
  });
});

it("does not treat a note's placeholder Codex choice as the conversation's model", () => {
  const main = send("main");
  const note = {
    ...send("note"),
    body: "A note to people",
    to: "message" as const,
    provider: "codex" as const,
  };
  expect(sentSettingsOf(note)).toBeUndefined();
  expect(
    lastComposerSettings(chat([user(main, 1), user(note, 2)], note)),
  ).toEqual({ id: main.id, ...sentSettingsOf(main) });
});

it("uses sequence order when clocks differ and does not go backwards to lastInput", () => {
  const old = send("old");
  const steered = send("steered");
  const data = chat(
    [
      { ...user(steered, 1), seq: 2 },
      { ...user(old, 10), seq: 1 },
    ],
    old,
  );
  expect(lastComposerSettings(data)?.id).toBe(steered.id);
});

it("never seeds a fresh main composer from an older side input", () => {
  expect(lastComposerSettings(chat([], send("reply", "root")))).toBeUndefined();
  expect(lastComposerSettings(undefined)).toBeUndefined();
});
