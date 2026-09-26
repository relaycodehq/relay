import { expect, it } from "vitest";
import {
  composeSend,
  newThreadSettings,
  switchAgent,
} from "../../mobile/src/remote/compose";
import { projectChatSendSchema } from "../../shared/projects";
import { defaultAISettings } from "../../shared/settings";

const id = "0b9e9a42-5f0e-4f3b-9d7a-9d6b3b0f4c11";

it("addresses the picked agent, as only a leading mention makes one answer", () => {
  const codex = newThreadSettings({
    ...defaultAISettings,
    questions: { model: "gpt-5.5", fast: true, reasoningEffort: "low" },
  });
  const sent = composeSend(codex, "  fix the flaky test ", { id });
  expect(sent).toEqual({
    id,
    body: "@codex fix the flaky test",
    provider: "codex",
    choice: { model: "gpt-5.5", fast: true, reasoningEffort: "low" },
    runtimeMode: "full-access",
    interactionMode: "default",
  });
  // The desktop accepts it as it would its own composer's.
  expect(projectChatSendSchema.parse(sent)).toEqual(sent);
  // A message that names its agent keeps that mention.
  expect(composeSend(codex, "@claude look", { id }).body).toBe("@claude look");
});

it("keeps Fast for Codex and the 200k window for Claude, never the other way round", () => {
  const claude = {
    ...switchAgent(newThreadSettings(defaultAISettings), "claude"),
    contextWindow: "200k" as const,
    choice: { model: "", fast: true, reasoningEffort: "" as const },
  };
  const sent = composeSend(claude, "hi", {
    id,
    parentId: id,
    delivery: "steer",
  });
  expect(sent).toMatchObject({
    choice: { fast: false },
    contextWindow: "200k",
    parentId: id,
    delivery: "steer",
  });
  // Switching agents starts the new one on its Default model, without Claude's window.
  const back = switchAgent(claude, "codex");
  expect(back.choice).toEqual({ model: "", fast: false, reasoningEffort: "" });
  expect(back).not.toHaveProperty("contextWindow");
  expect(projectChatSendSchema.parse(sent)).toEqual(sent);
});
