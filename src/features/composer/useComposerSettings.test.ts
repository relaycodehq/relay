// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mount, update } from "../../../tests/unit/hook-harness";
import { defaultAISettings } from "../../../shared/settings";
import type { SentComposerSettings } from "../../../shared/projects";
import type { AgentProvider } from "../../../shared/agents";
import type { NewThreadModels } from "../../../shared/new-thread-models";
import type { RuntimeMode } from "../../../shared/agent-modes";
import { onWindow } from "../../../shared/model-fit";
import {
  cacheNewThreadModels,
  loadComposerSettings,
  saveComposerSettings,
  startThreadSettings,
  withSent,
} from "../agents/composer-settings";
import { useComposerSettings } from "./useComposerSettings";

vi.mock("../agents/useAISettings", () => ({
  useAISettings: () => ({ data: defaultAISettings }),
}));

const follow = vi.hoisted(() => ({
  models: vi.fn(),
  agent: vi.fn(),
  lastModels: undefined as NewThreadModels | undefined,
  lastAgent: undefined as AgentProvider | undefined,
  lastMode: undefined as RuntimeMode | undefined,
  saveModel: vi.fn(),
  saveAgent: vi.fn(),
  saveMode: vi.fn(),
}));

vi.mock("./useNewThreadModels", () => ({
  useNewThreadModels: (enabled: boolean) => {
    follow.models(enabled);
    return [follow.lastModels, follow.saveModel];
  },
}));

vi.mock("./useNewThreadRuntimeMode", () => ({
  useNewThreadRuntimeMode: () => [follow.lastMode, follow.saveMode],
}));

vi.mock("./useNewThreadAgent", () => ({
  useNewThreadAgent: (enabled: boolean) => {
    follow.agent(enabled);
    return [follow.lastAgent, follow.saveAgent];
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  follow.lastModels = undefined;
  follow.lastAgent = undefined;
  follow.lastMode = undefined;
});

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
  current.rerender();
  expect(current().models.claude?.choice).toEqual(launch.choice);
  expect(loadComposerSettings("thread").sent).toBe(launch.id);
  update(() =>
    current().setModels((models) => ({
      ...models,
      claude: { choice: { ...launch.choice, reasoningEffort: "high" } },
    })),
  );
  lastSent = { ...launch };
  current.rerender();
  expect(current().models.claude?.choice.reasoningEffort).toBe("high");
  current.unmount();
  const reopened = mount(() =>
    useComposerSettings({ key: "thread", lastSent }),
  );
  expect(reopened().models.claude?.choice.reasoningEffort).toBe("high");
});

it("keeps picks made during a local send but adopts a genuinely new send from another device", () => {
  let lastSent = launch;
  const current = mount(() => useComposerSettings({ key: "thread", lastSent }));
  update(() => current().noteSent("local"));
  update(() =>
    current().setModels((models) => ({
      ...models,
      claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
    })),
  );
  lastSent = { ...launch, id: "local" };
  current.rerender();
  expect(current().models.claude?.choice.reasoningEffort).toBe("low");
  lastSent = {
    ...launch,
    id: "phone",
    provider: "codex",
    choice: { model: "gpt-6-sol", fast: true, reasoningEffort: "high" },
  };
  current.rerender();
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
  update(() => beforeRequest.noteSent("failed"));
  update(() =>
    current().setModels((models) => ({
      ...models,
      claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
    })),
  );
  // The callback belongs to the render that dispatched the failed request.
  update(() => beforeRequest.noteSent(launch.id));
  expect(
    loadComposerSettings("thread").models.claude?.choice.reasoningEffort,
  ).toBe("low");
});

it("keeps a pending queue or steer's baseline, preserving picks when it goes out", () => {
  let lastSent = launch;
  const current = mount(() => useComposerSettings({ key: "thread", lastSent }));
  update(() => current().noteSent("queued", true));
  update(() =>
    current().setModels((models) => ({
      ...models,
      claude: { choice: { ...launch.choice, reasoningEffort: "low" } },
    })),
  );
  expect(loadComposerSettings("thread").sent).toBe(launch.id);
  const saved = loadComposerSettings("thread");
  expect(withSent(saved, launch)).toBe(saved);
  lastSent = { ...launch, id: "queued" };
  current.rerender();
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
  expect(current().models.claude?.contextWindow).toBe("200k");
  update(() =>
    current().setModels((m) => ({ ...m, claude: onWindow(m.claude!, "1m") })),
  );
  // A 200k send to Codex in another thread.
  follow.lastModels = opus200k;
  follow.lastAgent = "codex";
  current.rerender();
  expect(current().models.claude?.contextWindow).toBeUndefined();
  expect(current().provider).toBe("claude");
  cacheNewThreadModels(opus200k);
  current.unmount();
  current = mount(draft);
  expect(current().models.claude?.contextWindow).toBeUndefined();
  expect(current().provider).toBe("claude");
  expect(follow.saveAgent).not.toHaveBeenCalled();
});

it("opens a new draft on the access last picked or sent with, and remembers a pick in it", () => {
  const draft = () => useComposerSettings({ key: "new:p" });
  let current = mount(draft);
  expect(current().runtimeMode).toBe("auto-accept-edits");
  follow.lastMode = "read-only";
  current.rerender();
  expect(current().runtimeMode).toBe("read-only");
  update(() => current().setRuntimeMode("full-access"));
  expect(follow.saveMode).toHaveBeenCalledWith("full-access");
  // Its own pick stands, whatever another device picks after.
  follow.lastMode = "approval-required";
  current.rerender();
  expect(current().runtimeMode).toBe("full-access");
  // An existing thread's pick is its own.
  current.unmount();
  follow.saveMode.mockClear();
  current = mount(() => useComposerSettings({ key: "thread" }));
  expect(current().runtimeMode).toBe("auto-accept-edits");
  update(() => current().setRuntimeMode("read-only"));
  expect(follow.saveMode).not.toHaveBeenCalled();
});

it("creates the next draft on the shared picks after one starts a thread", () => {
  follow.lastModels = opus200k;
  const draft = () => useComposerSettings({ key: "new:p" });
  let current = mount(draft);
  update(() =>
    current().setModels((m) => ({ ...m, claude: onWindow(m.claude!, "1m") })),
  );
  startThreadSettings("new:p", "thread", "claude");
  expect(loadComposerSettings("thread").frozen).toBeUndefined();
  cacheNewThreadModels(opus200k);
  current.unmount();
  current = mount(draft);
  expect(current().models.claude?.contextWindow).toBe("200k");
});

it("lets go of its picks when it starts a thread before its own send renders", () => {
  follow.lastModels = opus200k;
  const draft = () => useComposerSettings({ key: "new:p" });
  let current = mount(draft);
  update(() =>
    current().setModels((m) => ({ ...m, claude: onWindow(m.claude!, "1m") })),
  );
  // The thread can start before the composer renders the send it noted.
  update(() => {
    current().noteSent("first");
    startThreadSettings("new:p", "thread", "claude");
  });
  expect(current().models.claude?.contextWindow).toBe("200k");
  current.unmount();
  current = mount(draft);
  expect(current().models.claude?.contextWindow).toBe("200k");
});
