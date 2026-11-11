// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mount, update } from "../../../tests/unit/hook-harness";
import { defaultAISettings } from "../../../shared/settings";
import type { AgentProvider } from "../../../shared/agents";
import { composerSettingsKey } from "../../lib/thread-storage";
import {
  loadComposerSettings,
  saveComposerSettings,
} from "../agents/composer-settings";
import { useComposerSettings } from "./useComposerSettings";
import { useDraftProvider } from "./useDraftProvider";

const shared = vi.hoisted(() => ({
  lastAgent: "codex" as AgentProvider,
  agentsOff: [] as AgentProvider[],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: shared.lastAgent }),
}));

vi.mock("../agents/useAISettings", () => ({
  useAISettings: () => ({
    data: { ...defaultAISettings, agentsOff: shared.agentsOff },
  }),
}));

vi.mock("./useNewThreadAgent", () => ({
  newThreadAgentQuery: {},
  useNewThreadAgent: () => [shared.lastAgent, vi.fn()],
}));

vi.mock("./useNewThreadModels", () => ({
  useNewThreadModels: () => [undefined, vi.fn()],
}));

vi.mock("./useNewThreadRuntimeMode", () => ({
  useNewThreadRuntimeMode: () => [undefined, vi.fn()],
}));

const id = "new:project";

beforeEach(() => {
  localStorage.clear();
  shared.lastAgent = "codex";
  shared.agentsOff = [];
});

it("matches a frozen composer's agent while shared picks change elsewhere", () => {
  saveComposerSettings(id, {
    ...loadComposerSettings(id),
    provider: "claude",
    frozen: true,
  });
  const current = mount(() => ({
    card: useDraftProvider(id),
    composer: useComposerSettings({ key: id }),
  }));
  expect(current().card).toBe("claude");
  expect(current().card).toBe(current().composer.provider);
  shared.lastAgent = "opencode";
  current.rerender();
  expect(current().card).toBe(current().composer.provider);
  expect(current().card).toBe("claude");
});

it("updates from composer picks without needing the draft text to change", () => {
  saveComposerSettings(id, { ...loadComposerSettings(id), frozen: true });
  const current = mount(() => ({
    card: useDraftProvider(id),
    composer: useComposerSettings({ key: id }),
  }));
  for (const provider of ["claude", "message", "codex"] as const) {
    update(() => current().composer.setProvider(provider));
    expect(current().card).toBe(provider);
    expect(current().card).toBe(current().composer.provider);
  }
});

it("follows shared picks until frozen, falling back for a disabled agent", () => {
  const current = mount(() => useDraftProvider(id));
  shared.lastAgent = "claude";
  current.rerender();
  expect(current()).toBe("claude");
  shared.agentsOff = ["claude"];
  current.rerender();
  expect(current()).toBe(defaultAISettings.threadProvider);
});

it("hears settings saved in another window and follows a different draft", () => {
  let key = id;
  const current = mount(() => useDraftProvider(key));
  update(() => {
    localStorage.setItem(
      composerSettingsKey(id),
      JSON.stringify({
        agent: "claude",
        frozen: true,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: composerSettingsKey(id),
      }),
    );
  });
  expect(current()).toBe("claude");
  key = "new:other";
  current.rerender();
  expect(current()).toBe("codex");
  update(() =>
    saveComposerSettings(key, {
      ...loadComposerSettings(key),
      provider: "message",
      frozen: true,
    }),
  );
  expect(current()).toBe("message");
});
