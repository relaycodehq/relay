import { expect, it } from "vitest";
import {
  composeSend,
  desktopNewThreadSettings,
  newThreadSettings,
  withComposerChange,
  withRememberedModel,
  switchAgent,
} from "../../shared/remote-compose";
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

it("starts new threads on the agent last picked for one, else the default agent", async () => {
  const ai = { ...defaultAISettings, threadProvider: "cursor" as const };
  const opus = { model: "opus", fast: false, reasoningEffort: "max" as const };
  const desktop = (last: string | null | Error, models = {}) =>
    (async (method: string) => {
      if (method === "aiSettings") return ai;
      if (last instanceof Error) throw last;
      if (method === "newThreadModels") return models;
      return last;
    }) as Parameters<typeof desktopNewThreadSettings>[0];

  const claude = await desktopNewThreadSettings(desktop("claude"));
  expect(claude.provider).toBe("claude");
  expect(claude.choice.model).toBe("");
  // On the model it last ran with, from the desktop or the phone.
  expect(
    await desktopNewThreadSettings(
      desktop("claude", {
        claude: { choice: opus, contextWindow: "200k" },
        codex: { choice: { model: "", fast: false, reasoningEffort: "" } },
      }),
    ),
  ).toMatchObject({ provider: "claude", choice: opus, contextWindow: "200k" });
  // A blank Codex pick keeps the line-question model the desktop defaults to.
  const questions = {
    model: "gpt-6-sol",
    fast: false,
    reasoningEffort: "high" as const,
  };
  expect(
    withRememberedModel(
      newThreadSettings(
        { ...ai, questionsProvider: "codex", questions },
        "codex",
      ),
      { codex: { choice: { model: "", fast: false, reasoningEffort: "" } } },
    ).choice,
  ).toEqual(questions);
  expect((await desktopNewThreadSettings(desktop(null))).provider).toBe(
    "cursor",
  );
  // A desktop from before the method turns it down.
  expect(
    (await desktopNewThreadSettings(desktop(new Error("Invalid enum"))))
      .provider,
  ).toBe("cursor");
});

it("puts /model on the model's agent, as the desktop does", () => {
  const catalogs = {
    claude: [
      {
        id: "opus",
        name: "Opus",
        description: "",
        efforts: ["high" as const],
        longContext: true,
      },
    ],
  };
  const codex = {
    ...newThreadSettings(defaultAISettings, "codex"),
    choice: {
      model: "gpt-6-luna",
      fast: true,
      reasoningEffort: "high" as const,
    },
  };
  // The composer keeps each agent's settings; here Claude kept max and 200k.
  const kept: typeof switchAgent = (s, to) =>
    to === "claude"
      ? {
          ...switchAgent(s, to),
          choice: { model: "", fast: false, reasoningEffort: "max" },
          contextWindow: "200k",
        }
      : switchAgent(s, to);
  const change = {
    command: "model",
    provider: "claude",
    model: "opus",
  } as const;
  // Opus has no max, so Default; the 200k window stays.
  expect(withComposerChange(codex, change, catalogs, kept)).toEqual({
    ...codex,
    provider: "claude",
    choice: { model: "opus", fast: false, reasoningEffort: "" },
    contextWindow: "200k",
  });
  // A model with 1M built in has no 200k window to keep.
  expect(
    withComposerChange(codex, { ...change, model: "opus[1m]" }, catalogs, kept),
  ).not.toHaveProperty("contextWindow");
  // Staying on Codex keeps an effort its unlisted model takes.
  expect(
    withComposerChange(
      codex,
      { command: "model", provider: "codex", model: "gpt-7" },
      catalogs,
    ).choice,
  ).toEqual({ model: "gpt-7", fast: true, reasoningEffort: "high" });
});
