import { expect, it, vi } from "vitest";
import type { AgentModel, AgentProvider } from "../../shared/agents";
import type { ModelCatalogs } from "../../shared/composer-commands";
import type { RemoteClient } from "../../shared/remote-client";

vi.mock("../../mobile/src/remote/offline", () => ({
  loadModels: async () => ({}),
  saveModels: () => {},
}));
// Loaded by a path tsc doesn't follow: offline.ts's Expo imports would bring
// React Native's globals into the tests project, which clash with Node's.
const catalogs = "../../mobile/src/remote/model-catalogs";
const { loadModelLists, newModelConnection } = (await import(catalogs)) as {
  loadModelLists: (
    desktop: RemoteClient["desktop"],
    wanted: readonly AgentProvider[],
  ) => Promise<ModelCatalogs>;
  newModelConnection: () => void;
};

const opus: AgentModel = {
  id: "opus",
  name: "Opus 5.5",
  description: "",
  efforts: [],
};

/** A desktop answering with `lists` in turn, counting how often it's asked. */
function desktopAnswering(...lists: AgentModel[][]) {
  const ask = vi.fn(async () => lists.shift() ?? []);
  return { ask, desktop: ask as unknown as RemoteClient["desktop"] };
}

it("asks again for a list that came back empty while the CLI started", async () => {
  const { ask, desktop } = desktopAnswering([], [opus]);
  expect((await loadModelLists(desktop, ["claude"])).claude).toBeUndefined();
  expect((await loadModelLists(desktop, ["claude"])).claude).toEqual([opus]);
  await loadModelLists(desktop, ["claude"]);
  expect(ask).toHaveBeenCalledTimes(2);
});

it("asks again on a new connection to the same desktop", async () => {
  const { ask, desktop } = desktopAnswering([opus], [opus]);
  await loadModelLists(desktop, ["claude"]);
  await loadModelLists(desktop, ["claude"]);
  expect(ask).toHaveBeenCalledTimes(1);
  newModelConnection();
  await loadModelLists(desktop, ["claude"]);
  expect(ask).toHaveBeenCalledTimes(2);
});
