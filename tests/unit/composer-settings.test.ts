import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadComposerSettings,
  resetComposerModels,
  saveComposerSettings,
  saveSentSettings,
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
  expect(loadComposerSettings("chat", false)).toEqual({
    provider: "claude",
    choice: sol,
    claude: { model: "claude-sonnet-4-6", reasoningEffort: "low" },
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
  expect(loadComposerSettings("chat", false)).toMatchObject({
    provider: "message",
    choice: { model: "gpt-6-luna" },
    claude: { model: "claude-sonnet-4-6" },
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
    loadComposerSettings("chat:reply", false, {
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
      mode: "ask",
    }),
  );
  const defaults = {
    choice: undefined,
    claude: { model: "", reasoningEffort: "" },
    interactionMode: "default",
    ultraplan: false,
    council: "angles",
  };
  expect(loadComposerSettings("a", true)).toEqual({
    ...defaults,
    provider: "message",
    runtimeMode: "full-access",
  });
  expect(loadComposerSettings("b", false)).toEqual({
    ...defaults,
    provider: "codex",
    runtimeMode: "approval-required",
  });
});

it("starts the next new thread on Default, keeping the agent and modes", () => {
  saveComposerSettings("new:project", {
    provider: "claude",
    choice: sol,
    claude: { model: "claude-fable-5-1[1m]", reasoningEffort: "xhigh" },
    runtimeMode: "auto",
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  });
  resetComposerModels("new:project");
  expect(loadComposerSettings("new:project", false)).toEqual({
    provider: "claude",
    choice: undefined,
    claude: { model: "", reasoningEffort: "" },
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
  expect(loadComposerSettings("odd", false)).toMatchObject({
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
  expect(loadComposerSettings("on", false)).toMatchObject({
    interactionMode: "plan",
    ultraplan: true,
    council: "same",
  });
});
