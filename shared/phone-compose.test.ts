import { expect, it } from "vitest";
import {
  composeSend,
  conversationSettings,
  desktopNewThreadSettings,
  newThreadSettings,
  remotePlanGoAhead,
  withComposerChange,
  withRememberedModel,
  switchAgent,
} from "./remote-compose";
import { projectChatSendSchema } from "./projects";
import { defaultAISettings } from "./settings";
import { onWindow } from "./model-fit";

const id = "0b9e9a42-5f0e-4f3b-9d7a-9d6b3b0f4c11";

it("sends Claude's selected window and follows desktop model-picking rules", () => {
  const settings = {
    ...newThreadSettings(defaultAISettings, "claude"),
    choice: {
      model: "opus[1m]",
      fast: false,
      reasoningEffort: "high" as const,
    },
  };
  const catalogs = {
    claude: [
      {
        id: "sonnet",
        name: "Sonnet",
        description: "",
        efforts: ["high" as const],
        longContext: true,
      },
    ],
  };
  const pick = {
    command: "model",
    provider: "claude",
    model: "sonnet",
  } as const;
  // Choosing a bare model leaves its window to Claude, exactly as the desktop picker does.
  expect(withComposerChange(settings, pick, catalogs).choice.model).toBe(
    "sonnet",
  );
  const small = onWindow(settings, "200k");
  expect(composeSend(small, "hello", { id })).toMatchObject({
    choice: { model: "opus" },
    contextWindow: "200k",
  });
  expect(withComposerChange(small, pick, catalogs)).toMatchObject({
    choice: { model: "sonnet", reasoningEffort: "high" },
    contextWindow: "200k",
  });
  const large = onWindow(small, "1m");
  const sent = composeSend(large, "hello", { id });
  expect(sent.choice?.model).toBe("opus[1m]");
  expect(sent).not.toHaveProperty("contextWindow");
  const explicit = withComposerChange(
    small,
    { ...pick, model: "sonnet[1m]" },
    catalogs,
  );
  expect(explicit.choice.model).toBe("sonnet[1m]");
  expect(explicit).not.toHaveProperty("contextWindow");
});

it("addresses the picked agent, as only a leading mention makes one answer", () => {
  const codex = newThreadSettings({
    ...defaultAISettings,
    questions: { model: "gpt-5.5", fast: true, reasoningEffort: "low" },
  });
  const sent = composeSend(codex, "  fix the flaky test ", { id });
  expect(sent).toEqual({
    id,
    body: "@codex fix the flaky test",
    to: "codex",
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

it("goes ahead with a plan from the phone in Build, and leaves the composer there", () => {
  const planning = {
    ...switchAgent(newThreadSettings(defaultAISettings), "claude"),
    interactionMode: "plan" as const,
  };
  const { send, nextSettings } = remotePlanGoAhead(planning, "claude", id);
  expect(send).toMatchObject({ id, to: "claude", interactionMode: "default" });
  expect(projectChatSendSchema.parse(send)).toEqual(send);
  expect(nextSettings).toEqual({ ...planning, interactionMode: "default" });
});

it("hands a plan from a phone composer on Codex to Claude on Claude's Default, not Codex's model", () => {
  const codex = {
    ...newThreadSettings(defaultAISettings, "codex"),
    choice: { model: "gpt-5.5", fast: true, reasoningEffort: "high" as const },
    interactionMode: "plan" as const,
  };
  const { send, nextSettings } = remotePlanGoAhead(codex, "claude", id);
  expect(send).toMatchObject({
    to: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
  });
  expect(nextSettings).toMatchObject({
    provider: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
    interactionMode: "default",
  });
});

it("opens the main conversation on the agent holding it when a side reply was the last send", () => {
  const codex = newThreadSettings(defaultAISettings, "codex");
  const claudeReply = {
    ...switchAgent(codex, "claude"),
    choice: { model: "opus", fast: false, reasoningEffort: "high" as const },
  };
  // Last send was a reply under "r1"; the main conversation is Codex's.
  expect(conversationSettings(claudeReply, "r1", undefined, "codex")).toEqual(
    switchAgent(claudeReply, "codex"),
  );
  // The reply's own conversation keeps what it last sent.
  expect(conversationSettings(claudeReply, "r1", "r1", "codex")).toBe(
    claudeReply,
  );
  // A main send, or a conversation nobody has answered in, stays as it was.
  expect(conversationSettings(claudeReply, null, undefined, "codex")).toBe(
    claudeReply,
  );
  expect(conversationSettings(claudeReply, "r1", undefined, undefined)).toBe(
    claudeReply,
  );
});
