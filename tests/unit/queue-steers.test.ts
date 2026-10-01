import { expect, it } from "vitest";
import { steers } from "../../electron/project-chats/queue";
import type { ProjectChatSend } from "../../shared/projects";

const send = (
  body: string,
  fields: Partial<ProjectChatSend> = {},
): ProjectChatSend => ({
  id: crypto.randomUUID(),
  body,
  provider: "codex",
  runtimeMode: "approval-required",
  interactionMode: "default",
  choice: { model: "m", reasoningEffort: "high", fast: false },
  ...fields,
});
const running = send("@codex Fix the cache guard");

it("steers with a follow-up to the same agent on the same settings", () => {
  expect(steers(send("@codex Also check the tests"), running, false)).toBe(
    true,
  );
});

it("waits when nothing runs or the message isn't for an agent", () => {
  expect(steers(send("@codex Also"), undefined, false)).toBe(false);
  expect(steers(send("A note to self"), running, false)).toBe(false);
});

it("waits for a different agent, conversation or setting", () => {
  for (const next of [
    send("@claude Also"),
    send("@codex Also", { parentId: "side" }),
    send("@codex Also", { runtimeMode: "full-access" }),
    send("@codex Also", { interactionMode: "plan" }),
    send("@codex Also", {
      choice: { model: "other", reasoningEffort: "high", fast: false },
    }),
    send("@codex Also", { contextWindow: "1m" as never }),
  ])
    expect(steers(next, running, false)).toBe(false);
});

it("waits for what an agent only takes at the start of a turn", () => {
  const image = {
    name: "s.png",
    mimeType: "image/png" as const,
    dataUrl: "data:image/png;base64,",
  };
  expect(steers(send("@codex /review"), running, false)).toBe(false);
  expect(steers(send("@codex run $deploy now"), running, false)).toBe(false);
  expect(steers(send("@codex use /skill:lint"), running, false)).toBe(false);
  expect(
    steers(send("@codex this", { selection: {} as never }), running, false),
  ).toBe(false);
  // A screenshot can steer a private thread, not a shared one.
  const shot = send("@codex look", { images: [image] });
  expect(steers(shot, running, false)).toBe(true);
  expect(steers(shot, running, true)).toBe(false);
});
