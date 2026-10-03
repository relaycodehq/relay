import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  composerProvider,
  cacheNewThreadModels,
  followLastAgent,
  type AgentFollow,
  loadComposerSettings,
  saveComposerSettings,
  saveSentSettings,
  startThreadSettings,
  type ComposerSettings,
} from "./composer-settings";
import { newThreadModelsOf, withNewThreadModels } from "./composer-models";
import { sentModel } from "../../../shared/new-thread-models";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const sol = {
  model: "gpt-6-sol",
  fast: true,
  reasoningEffort: "high" as const,
};
const modes = {
  runtimeMode: "full-access",
  interactionMode: "default",
  ultraplan: false,
  council: "angles",
} as const;
const plain = (
  model: string,
  reasoningEffort: "" | "low" | "high" | "max" = "",
) => ({ choice: { model, fast: false, reasoningEffort } });

it("reopens a returned Claude message on Claude's model, keeping Codex's", () => {
  saveComposerSettings("chat", {
    ...modes,
    provider: "codex",
    models: { codex: { choice: sol }, claude: plain("opus", "max") },
  });
  saveSentSettings("chat", "claude", {
    provider: "claude",
    choice: { model: "claude-sonnet-4-6", fast: false, reasoningEffort: "low" },
    runtimeMode: "auto",
    interactionMode: "plan",
  });
  expect(loadComposerSettings("chat")).toEqual({
    provider: "claude",
    models: {
      codex: { choice: sol },
      claude: plain("claude-sonnet-4-6", "low"),
    },
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: false,
    council: "angles",
  });
  // A Codex or message-only one carries Codex's choice.
  saveSentSettings("chat", "message", {
    provider: "codex",
    choice: { ...sol, model: "gpt-6-luna" },
    runtimeMode: "auto",
    interactionMode: "default",
  });
  expect(loadComposerSettings("chat")).toMatchObject({
    provider: "message",
    models: {
      codex: { choice: { model: "gpt-6-luna" } },
      claude: { choice: { model: "claude-sonnet-4-6" } },
    },
  });
});

it("starts a side conversation from the thread's settings, on its agent", () => {
  saveSentSettings("chat", "codex", {
    provider: "codex",
    choice: sol,
    runtimeMode: "auto",
    interactionMode: "plan",
  });
  expect(
    loadComposerSettings("chat:reply", {
      settingsKey: "chat",
      provider: "claude",
    }),
  ).toMatchObject({
    provider: "claude",
    models: { codex: { choice: sol } },
    runtimeMode: "auto",
  });
});

it("falls back to defaults for anything unreadable", () => {
  store.set("composer-settings:a", "{not json");
  store.set(
    "composer-settings:b",
    JSON.stringify({
      provider: "gpt",
      choice: { model: "gpt-5.5", fast: false, reasoningEffort: "turbo" },
      claude: { model: "bad id!", reasoningEffort: "turbo" },
      picks: {},
      mode: "ask",
    }),
  );
  const defaults = {
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
    provider: undefined,
  };
  expect(loadComposerSettings("a")).toEqual({
    ...defaults,
    models: {},
    runtimeMode: "full-access",
  });
  // What reads is kept: Codex's model, without the level it doesn't know.
  expect(loadComposerSettings("b")).toEqual({
    ...defaults,
    models: { codex: plain("gpt-5.5"), claude: plain("") },
    runtimeMode: "approval-required",
  });
});

it("starts every new thread on the models the desktop and phone share", () => {
  saveComposerSettings("new:a", {
    ...modes,
    provider: "claude",
    models: { claude: plain("sonnet", "high"), cursor: plain("auto") },
    runtimeMode: "auto",
    interactionMode: "plan",
  });
  // Only the agents the phone or desktop remembered move; modes stay.
  cacheNewThreadModels({
    codex: { choice: sol },
    claude: {
      choice: { model: "opus", fast: false, reasoningEffort: "max" },
      contextWindow: "200k",
    },
  });
  const loaded = loadComposerSettings("new:a");
  expect(loaded).toMatchObject({
    provider: "claude",
    models: {
      codex: { choice: sol },
      claude: { ...plain("opus", "max"), contextWindow: "200k" },
      cursor: plain("auto"),
    },
    interactionMode: "plan",
  });
  // A thread with nothing saved here, from the phone or another build,
  // opens on them too, not on Codex's Default.
  expect(loadComposerSettings("unseen").models).toMatchObject({
    codex: { choice: sol },
    claude: { ...plain("opus", "max"), contextWindow: "200k" },
  });
  // A thread's own settings stay its own.
  saveComposerSettings("thread", {
    ...loaded,
    models: { ...loaded.models, codex: undefined },
  });
  expect(loadComposerSettings("thread").models.codex).toBeUndefined();
  // Shared and read back, every agent keeps its model; Codex's Default
  // follows the line-question setting again.
  expect(
    withNewThreadModels(loaded.models, newThreadModelsOf(loaded.models)),
  ).toEqual({ ...loaded.models, opencode: plain("") });
});

it("remembers the model a message went to an agent with, not one to people", () => {
  const choice = {
    model: "opus",
    fast: false,
    reasoningEffort: "max" as const,
  };
  expect(
    sentModel({
      body: "@claude hi",
      provider: "claude",
      choice,
      contextWindow: "200k",
    }),
  ).toEqual(["claude", { choice, contextWindow: "200k" }]);
  expect(
    sentModel({ body: "hi all", provider: "codex", choice }),
  ).toBeUndefined();
});

it("keeps Ultraplan and its council, and reads anything else as off", () => {
  store.set(
    "composer-settings:odd",
    JSON.stringify({ ultraplan: "yes", council: "debate" }),
  );
  expect(loadComposerSettings("odd")).toMatchObject({
    ultraplan: false,
    council: "angles",
  });
  store.set(
    "composer-settings:on",
    JSON.stringify({
      interactionMode: "plan",
      ultraplan: true,
      council: "same",
    }),
  );
  expect(loadComposerSettings("on")).toMatchObject({
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  });
});

it("follows the default agent until one is picked", () => {
  expect(composerProvider(undefined, false, "claude")).toBe("claude");
  expect(composerProvider(undefined, true, "claude")).toBe("message");
  expect(composerProvider("codex", false, "claude")).toBe("codex");
  saveComposerSettings("new:project", { ...modes, models: {} });
  expect(loadComposerSettings("new:project").provider).toBeUndefined();
});

it("reads an old new-thread Codex as the old default, other agents as picks", () => {
  const old = (provider: string) => JSON.stringify({ provider });
  store.set("composer-settings:new:a", old("codex"));
  store.set("composer-settings:new:b", old("claude"));
  store.set("composer-settings:thread", old("codex"));
  expect(loadComposerSettings("new:a").provider).toBeUndefined();
  expect(loadComposerSettings("new:b").provider).toBe("claude");
  expect(loadComposerSettings("thread").provider).toBe("codex");
});

it("starts a thread on the agent its first message went to", () => {
  saveComposerSettings("new:project", {
    ...modes,
    models: { codex: { choice: sol }, claude: plain("opus", "max") },
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
  });
  startThreadSettings("new:project", "thread", "claude");
  expect(loadComposerSettings("thread")).toMatchObject({
    provider: "claude",
    models: { codex: { choice: sol }, claude: plain("opus", "max") },
    interactionMode: "plan",
  });
  // The new-thread composer keeps following the default agent, on its models
  // and runtime mode, but the next thread starts in Build.
  expect(loadComposerSettings("new:project")).toMatchObject({
    provider: undefined,
    models: { codex: { choice: sol }, claude: { choice: { model: "opus" } } },
    runtimeMode: "auto",
    interactionMode: "default",
    ultraplan: false,
  });
});

it("keeps another agent's model in its own entry, apart from Codex's and Claude's", () => {
  saveComposerSettings("chat", {
    ...modes,
    provider: "codex",
    models: { codex: { choice: sol }, claude: plain("opus", "max") },
  });
  saveSentSettings("chat", "opencode", {
    provider: "opencode",
    choice: {
      model: "openrouter/anthropic/claude-opus-5",
      fast: false,
      reasoningEffort: "high",
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  expect(loadComposerSettings("chat")).toMatchObject({
    provider: "opencode",
    models: {
      codex: { choice: sol },
      claude: plain("opus", "max"),
      opencode: plain("openrouter/anthropic/claude-opus-5", "high"),
    },
    runtimeMode: "approval-required",
  });
  // An agent Relay doesn't know, or a model id it wouldn't send, isn't kept.
  store.set(
    "composer-settings:odd-picks",
    JSON.stringify({
      provider: "gemini",
      picks: { gemini: { model: "x" }, opencode: { model: "bad id!" } },
    }),
  );
  expect(loadComposerSettings("odd-picks")).toMatchObject({
    // An agent it doesn't know follows the default agent.
    provider: undefined,
    models: { opencode: plain("") },
  });
});

it("hands on agents picked here and takes up ones picked on the phone, without echoing its own", () => {
  let at: AgentFollow = {};
  const step = (
    last: Parameters<typeof followLastAgent>[1],
    picked: Parameters<typeof followLastAgent>[2],
  ) => {
    const next = followLastAgent(at, last, picked);
    at = next.at;
    return { adopt: next.adopt, save: next.save };
  };
  // Nothing picked for a new thread yet: only noted.
  expect(step(null, undefined)).toEqual({});
  expect(step(null, "claude")).toEqual({ save: "claude" });
  // Its own pick coming back as the last agent.
  expect(step("claude", "claude")).toEqual({});
  // Picked on the phone, then shown here.
  expect(step("codex", "claude")).toEqual({ adopt: "codex" });
  expect(step("codex", "codex")).toEqual({});
  // A note to the thread is no agent to start new threads on.
  expect(step("codex", "message")).toEqual({});
  expect(step("codex", "opencode")).toEqual({ save: "opencode" });
});

it("moves settings saved in the old shapes to `models`, and loses none", () => {
  const old = {
    agent: "claude",
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max", contextWindow: "200k" },
    picks: { cursor: { model: "auto", reasoningEffort: "" } },
    mode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  };
  store.set("composer-settings:chat", JSON.stringify(old));
  const loaded = loadComposerSettings("chat");
  const expected: ComposerSettings = {
    provider: "claude",
    models: {
      codex: { choice: sol },
      claude: { ...plain("opus", "max"), contextWindow: "200k" },
      cursor: plain("auto"),
    },
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  };
  expect(loaded).toEqual(expected);
  // Written back in the new shape only: the old keys go with the old blob.
  saveComposerSettings("chat", loaded);
  const written = JSON.parse(store.get("composer-settings:chat")!);
  expect(Object.keys(written).sort()).toEqual([
    "agent",
    "council",
    "interactionMode",
    "models",
    "runtimeMode",
    "ultraplan",
  ]);
  expect(loadComposerSettings("chat")).toEqual(expected);
});

it("reads what an older build writes over the new shape", () => {
  saveComposerSettings("chat", {
    ...modes,
    models: { claude: plain("opus", "max"), cursor: plain("auto") },
  });
  // A downgrade and upgrade: the older build saved its own keys, without `models`.
  store.set(
    "composer-settings:chat",
    JSON.stringify({ claude: { model: "sonnet", reasoningEffort: "low" } }),
  );
  expect(loadComposerSettings("chat").models).toEqual({
    claude: plain("sonnet", "low"),
  });
});
