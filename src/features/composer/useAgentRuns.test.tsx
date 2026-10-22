import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentProvider } from "../../../shared/agents";
import { useAgentRuns, type AgentRuns } from "./useAgentRuns";
import type { ComposerState } from "./useComposerSettings";
import type { ModelCatalogs } from "./useModelCatalogs";

/** The composer's runs on its first render, before Codex's settings have loaded. */
function firstRender(): AgentRuns {
  const state = {
    models: {
      opencode: {
        choice: { model: "openai/gpt-5", reasoningEffort: "", fast: false },
      },
    },
    codexChoice: undefined,
    setProvider: () => {},
    setModels: () => {},
  } as unknown as ComposerState;
  const catalogs = {
    claude: undefined,
    codex: [],
    picks: {
      opencode: {
        models: [
          {
            id: "openai/gpt-5",
            name: "GPT-5",
            description: "",
            efforts: ["low", "high"],
          },
        ],
      },
    },
    defaults: { of: () => undefined, effort: () => undefined },
    errorOf: () => undefined,
  } as unknown as ModelCatalogs;
  let runs!: AgentRuns;
  function Probe() {
    runs = useAgentRuns(state, catalogs, () => {});
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return runs;
}

it("offers an agent's own efforts without waiting for Codex's settings, which only Codex's control needs", () => {
  const runs = firstRender();
  expect(runs.codex).toBeFalsy();
  const offers = (to: AgentProvider) => runs.offersEffort(to);
  expect(offers("opencode")).toBe(true);
  expect(offers("codex")).toBe(false);
  expect(runs.sendSettings("codex")).toBeUndefined();
  expect(runs.sendSettings("opencode")?.choice.model).toBe("openai/gpt-5");
  expect(runs.sendSettings("claude")?.to).toBe("claude");
  expect(runs.sendSettings("message")?.to).toBe("message");
});
