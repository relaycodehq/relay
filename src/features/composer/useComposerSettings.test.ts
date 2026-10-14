import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";
import { defaultAISettings } from "../../../shared/settings";
import type { SentComposerSettings } from "../../../shared/projects";
import type { AgentProvider } from "../../../shared/agents";
import type { NewThreadModels } from "../../../shared/new-thread-models";
import { onWindow } from "../../../shared/model-fit";
import {
  cacheNewThreadModels,
  loadComposerSettings,
  saveComposerSettings,
  startThreadSettings,
  withSent,
} from "../agents/composer-settings";
import { useComposerSettings } from "./useComposerSettings";

vi.mock("react", () => harnessReact);
vi.mock("../agents/useAISettings", () => ({
  useAISettings: () => ({ data: defaultAISettings }),
}));
const follow = vi.hoisted(() => ({
  models: vi.fn(),
  agent: vi.fn(),
  lastModels: undefined as NewThreadModels | undefined,
  lastAgent: undefined as AgentProvider | undefined,
  saveModel: vi.fn(),
  saveAgent: vi.fn(),
}));
vi.mock("./useNewThreadModels", () => ({
  useNewThreadModels: (enabled: boolean) => {
    follow.models(enabled);
    return [follow.lastModels, follow.saveModel];
  },
}));
vi.mock("./useNewThreadAgent", () => ({
  useNewThreadAgent: (enabled: boolean) => {
    follow.agent(enabled);
    return [follow.lastAgent, follow.saveAgent];
  },
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  follow.lastModels = undefined;
  follow.lastAgent = undefined;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
const launch: SentComposerSettings = {
  id: "launch",
  provider: "claude",
  choice: { model: "opus", fast: false, reasoningEffort: "max" },
  runtimeMode: "auto",
  interactionMode: "plan",
};

it("restores a spawned thread after history loads without following shared draft picks", () => {
  cacheNewThreadModels({
    claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
  });
  let lastSent: SentComposerSettings | undefined;
  const current = mount(() =>
    useComposerSettings({ key: "thread", agent: "claude", lastSent }),
  );
  expect(current().models).toEqual({});
  expect(follow.models).toHaveBeenCalledWith(false);
  expect(follow.agent).toHaveBeenCalledWith(false);
  lastSent = launch;
  rerender();
  rerender();
  expect(current().models.claude?.choice).toEqual(launch.choice);
  expect(loadComposerSettings("thread").sent).toBe(launch.id);
  current().setModels((models) => ({
    ...models,
    claude: { choice: { ...launch.choice, reasoningEffort: "high" } },
  }));
  rerender();
  lastSent = { ...launch };
  rerender();
  expect(current().models.claude?.choice.reasoningEffort).toBe("high");
  const reopened = mount(() =>
    useComposerSettings({ key: "thread", lastSent }),
  );
  expect(reopened().models.claude?.choice.reasoningEffort).toBe("high");
});

it("keeps picks made during a local send but adopts a genuinely new send from another device", () => {
  let lastSent = launch;
  const current = mount(() => useComposerSettings({ key: "thread", lastSent }));
  current().noteSent("local");
  current().setModels((models) => ({
    ...models,
    claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
  }));
  rerender();
  lastSent = { ...launch, id: "local" };
  rerender();
  expect(current().models.claude?.choice.reasoningEffort).toBe("low");
  lastSent = {
    ...launch,
    id: "phone",
    provider: "codex",
    choice: { model: "gpt-6-sol", fast: true, reasoningEffort: "high" },
  };
  rerender();
  rerender();
  expect(current().provider).toBe("codex");
  expect(current().models.codex?.choice).toEqual(lastSent.choice);
  expect(current().models.claude?.choice.reasoningEffort).toBe("low");
});

it("corrects previously saved leaked defaults once, then acknowledges that baseline", () => {
  saveComposerSettings("thread", {
    models: {
      claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
    },
    runtimeMode: "full-access",
    interactionMode: "default",
  });
  const current = mount(() =>
    useComposerSettings({ key: "thread", lastSent: launch }),
  );
  expect(current().models.claude?.choice).toEqual(launch.choice);
  expect(current().sent).toBe(launch.id);
});

it("rolling back a failed send acknowledges the old baseline without losing newer picks", () => {
  const current = mount(() =>
    useComposerSettings({ key: "thread", lastSent: launch }),
  );
  const beforeRequest = current();
  beforeRequest.noteSent("failed");
  rerender();
  current().setModels((models) => ({
    ...models,
    claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
  }));
  rerender();
  // The callback belongs to the render that dispatched the failed request.
  beforeRequest.noteSent(launch.id);
  expect(
    loadComposerSettings("thread").models.claude?.choice.reasoningEffort,
  ).toBe("low");
});

it("keeps a pending queue or steer's baseline on reopen, and preserves picks when it goes out", () => {
  let lastSent = launch;
  const current = mount(() => useComposerSettings({ key: "thread", lastSent }));
  current().noteSent("queued", true);
  current().setModels((models) => ({
    ...models,
    claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
  }));
  rerender();
  expect(loadComposerSettings("thread").sent).toBe(launch.id);
  const saved = loadComposerSettings("thread");
  expect(withSent(saved, launch)).toBe(saved);
  lastSent = { ...launch, id: "queued" };
  rerender();
  rerender();
  expect(current().models.claude?.choice.reasoningEffort).toBe("low");
  expect(current().sent).toBe("queued");
});

const opus = {
  model: "claude-opus-5-5",
  fast: false,
  reasoningEffort: "" as const,
};
const opus200k: NewThreadModels = {
  claude: { choice: opus, contextWindow: "200k" },
};

it("freezes a new draft once created: sends and picks elsewhere leave it be", () => {
  follow.lastModels = opus200k;
  follow.lastAgent = "claude";
  const draft = () => useComposerSettings({ key: "new:p" });
  let current = mount(draft);
  rerender();
  expect(current().models.claude?.contextWindow).toBe("200k");
  current().setModels((m) => ({ ...m, claude: onWindow(m.claude!, "1m") }));
  rerender();
  rerender();
  // A 200k send to Codex in another thread.
  follow.lastModels = opus200k;
  follow.lastAgent = "codex";
  rerender();
  rerender();
  expect(current().models.claude?.contextWindow).toBeUndefined();
  expect(current().provider).toBe("claude");
  cacheNewThreadModels(opus200k);
  current = mount(draft);
  rerender();
  rerender();
  expect(current().models.claude?.contextWindow).toBeUndefined();
  expect(current().provider).toBe("claude");
  expect(follow.saveAgent).not.toHaveBeenCalled();
});

it("creates the next draft on the shared picks after one starts a thread", () => {
  follow.lastModels = opus200k;
  const draft = () => useComposerSettings({ key: "new:p" });
  let current = mount(draft);
  rerender();
  current().setModels((m) => ({ ...m, claude: onWindow(m.claude!, "1m") }));
  rerender();
  startThreadSettings("new:p", "thread", "claude");
  expect(loadComposerSettings("thread").frozen).toBeUndefined();
  cacheNewThreadModels(opus200k);
  current = mount(draft);
  rerender();
  expect(current().models.claude?.contextWindow).toBe("200k");
});
