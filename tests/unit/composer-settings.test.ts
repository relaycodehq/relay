import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  composerProvider,
  loadComposerSettings,
  resetComposerModels,
  saveComposerSettings,
  saveSentSettings,
  startThreadSettings,
} from "../../src/lib/composer-settings";

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

it("starts the next new thread on Default, keeping the agent and modes", () => {
  saveComposerSettings("new:project", {
    provider: "claude",
    choice: sol,
    claude: { model: "claude-fable-5-1[1m]", reasoningEffort: "xhigh" },
    picks: {},
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  });
  resetComposerModels("new:project");
  expect(loadComposerSettings("new:project")).toEqual({
    provider: "claude",
    choice: undefined,
    claude: { model: "", reasoningEffort: "" },
    picks: {},
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  });
  // Nothing saved yet stays that way.
  resetComposerModels("new:other");
  expect(store.has("composer-settings:new:other")).toBe(false);
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
    ultraplan: false,
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
  // The new-thread composer keeps following the default.
  expect(loadComposerSettings("new:project")).toMatchObject({
    provider: undefined,
    choice: undefined,
    claude: { model: "" },
    picks: {},
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
