import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  composerProvider,
  cacheNewThreadModels,
  claudeOn,
  followLastAgent,
  type AgentFollow,
  loadComposerSettings,
  newThreadModelsOf,
  saveComposerSettings,
  saveSentSettings,
  startThreadSettings,
  withNewThreadModels,
} from "./composer-settings";
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

it("reopens a returned Claude message on Claude's model, keeping Codex's", () => {
  saveComposerSettings("chat", {
    provider: "codex",
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max" },
    picks: {},
    runtimeMode: "full-access",
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
  });
  saveSentSettings("chat", "claude", {
    provider: "claude",
    choice: { model: "claude-sonnet-4-6", fast: false, reasoningEffort: "low" },
    runtimeMode: "auto",
    interactionMode: "plan",
  });
  expect(loadComposerSettings("chat")).toEqual({
    provider: "claude",
    choice: sol,
    claude: { model: "claude-sonnet-4-6", reasoningEffort: "low" },
    picks: {},
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
    choice: { model: "gpt-6-luna" },
    claude: { model: "claude-sonnet-4-6" },
    picks: {},
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
  ).toMatchObject({ provider: "claude", choice: sol, runtimeMode: "auto" });
});

it("falls back to defaults for anything unreadable", () => {
  store.set("composer-settings:a", "{not json");
  store.set(
    "composer-settings:b",
    JSON.stringify({
      provider: "gpt",
      choice: { model: "gpt-5.5", fast: false, reasoningEffort: "ultra" },
      claude: { model: "bad id!", reasoningEffort: "ultra" },
      picks: {},
      mode: "ask",
    }),
  );
  const defaults = {
    choice: undefined,
    claude: { model: "", reasoningEffort: "" },
    picks: {},
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
  };
  expect(loadComposerSettings("a")).toEqual({
    ...defaults,
    provider: undefined,
    runtimeMode: "full-access",
  });
  expect(loadComposerSettings("b")).toEqual({
    ...defaults,
    provider: undefined,
    runtimeMode: "approval-required",
  });
});

it("starts every new thread on the models the desktop and phone share", () => {
  saveComposerSettings("new:a", {
    provider: "claude",
    choice: undefined,
    claude: { model: "sonnet", reasoningEffort: "high" },
    picks: { cursor: { model: "auto", reasoningEffort: "" } },
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: false,
    council: "angles",
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
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max", contextWindow: "200k" },
    picks: { cursor: { model: "auto" } },
    interactionMode: "plan",
  });
  // A thread with nothing saved here, from the phone or another build,
  // opens on them too, not on Codex's Default.
  expect(loadComposerSettings("unseen")).toMatchObject({
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max", contextWindow: "200k" },
  });
  // A thread's own settings stay its own.
  saveComposerSettings("thread", { ...loaded, choice: undefined });
  expect(loadComposerSettings("thread").choice).toBeUndefined();
  // Shared and read back, every agent keeps its model; Codex's Default
  // follows the line-question setting again.
  const models = {
    choice: undefined,
    claude: loaded.claude,
    picks: loaded.picks,
  };
  expect(withNewThreadModels(models, newThreadModelsOf(models))).toEqual({
    choice: undefined,
    claude: loaded.claude,
    picks: { ...loaded.picks, opencode: { model: "", reasoningEffort: "" } },
  });
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
  saveComposerSettings("new:project", {
    claude: { model: "", reasoningEffort: "" },
    picks: {},
    runtimeMode: "auto",
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
  });
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
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max" },
    picks: {},
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "angles",
  });
  startThreadSettings("new:project", "thread", "claude");
  expect(loadComposerSettings("thread")).toMatchObject({
    provider: "claude",
    choice: sol,
    claude: { model: "opus" },
    picks: {},
    interactionMode: "plan",
  });
  // The new-thread composer keeps following the default agent, on its models
  // and runtime mode, but the next thread starts in Build.
  expect(loadComposerSettings("new:project")).toMatchObject({
    provider: undefined,
    choice: sol,
    claude: { model: "opus" },
    runtimeMode: "auto",
    interactionMode: "default",
    ultraplan: false,
  });
});

it("keeps another agent's model in its own slot, apart from Codex's and Claude's", () => {
  saveComposerSettings("chat", {
    provider: "codex",
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max" },
    picks: {},
    runtimeMode: "full-access",
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
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
    choice: sol,
    claude: { model: "opus", reasoningEffort: "max" },
    picks: {
      opencode: {
        model: "openrouter/anthropic/claude-opus-5",
        reasoningEffort: "high",
      },
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
    picks: { opencode: { model: "", reasoningEffort: "" } },
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

it("keeps Claude on a 200k window across models, unless the model is a [1m] one", () => {
  const opus = {
    model: "opus",
    reasoningEffort: "high" as const,
    contextWindow: "200k" as const,
  };
  expect(claudeOn(opus, "sonnet", "")).toEqual({
    model: "sonnet",
    reasoningEffort: "",
    contextWindow: "200k",
  });
  expect(claudeOn(opus, "sonnet[1m]", "max")).toEqual({
    model: "sonnet[1m]",
    reasoningEffort: "max",
  });
});
