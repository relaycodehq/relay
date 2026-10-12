import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import type { PromptCache } from "../../../shared/projects";
import type { ToolbarControls } from "./ComposerToolbar";
import { useSampleControls } from "./ComposerToolbarSample";

const current: { agent: AgentProvider; models: AgentModel[] } = {
  agent: "claude",
  models: [],
};
vi.mock("../../lib/api", () => ({ api: {} }));
vi.mock("../agents/useAISettings", () => ({
  useAISettings: () => ({ data: { threadProvider: current.agent } }),
}));
vi.mock("../agents/useCatalogs", () => ({
  useCatalogs: () => ({ modelsOf: () => current.models }),
}));

const model = (efforts: AgentModel["efforts"]): AgentModel => ({
  id: "m",
  name: "M",
  description: "",
  efforts,
});

function sampleFor(agent: AgentProvider, models: AgentModel[] = []) {
  Object.assign(current, { agent, models });
  let controls!: ToolbarControls;
  function Probe() {
    controls = useSampleControls();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  const meter = controls.context as ReactElement<{
    usage: { cache?: PromptCache };
  }>;
  return {
    effort: isValidElement(controls.effort)
      ? renderToStaticMarkup(controls.effort)
      : undefined,
    cache: meter.props.usage.cache,
  };
}

describe("the Settings toolbar sample", () => {
  it("shows the prompt cache only for Claude, whose sessions are the only ones that report one", () => {
    expect(sampleFor("claude").cache).toBeDefined();
    for (const agent of ["codex", "opencode", "cursor"] as const)
      expect(sampleFor(agent).cache).toBeUndefined();
  });

  it("leaves out the effort control for an agent whose model has no efforts, as the composer does", () => {
    expect(sampleFor("opencode", [model([])]).effort).toBeUndefined();
    expect(sampleFor("cursor").effort).toBeUndefined();
    const withEfforts = sampleFor("opencode", [model(["low", "high"])]).effort;
    expect(withEfforts).toContain("Default");
    expect(withEfforts).not.toContain("Fast");
  });

  it("gives Codex its effort and Fast", () => {
    expect(sampleFor("codex").effort).toMatch(/Medium[\s\S]*Fast/);
  });
});
