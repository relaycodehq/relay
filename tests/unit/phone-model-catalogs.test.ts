import { expect, it, vi } from "vitest";
import type { AgentModel, AgentProvider } from "../../shared/agents";
import type { ModelCatalogs } from "../../shared/composer-commands";
import type { RemoteClient } from "../../shared/remote-client";
import { composerCommand } from "../../shared/composer-commands";
import { supportsFast } from "../../shared/model-fit";

const { saveModels } = vi.hoisted(() => ({ saveModels: vi.fn() }));
vi.mock("../../mobile/src/remote/offline", () => ({
  loadModels: async () => ({}),
  saveModels,
}));
// Loaded by a path tsc doesn't follow: offline.ts's Expo imports would bring
// React Native's globals into the tests project, which clash with Node's.
const catalogs = "../../mobile/src/remote/model-catalogs";
const { loadModelLists, newModelConnection, knownModels } = (await import(
  catalogs
)) as {
  loadModelLists: (
    desktop: RemoteClient["desktop"],
    wanted: readonly AgentProvider[],
  ) => Promise<ModelCatalogs>;
  newModelConnection: () => void;
  knownModels: (desktop: RemoteClient["desktop"]) => ModelCatalogs;
};

const opus: AgentModel = {
  id: "opus",
  name: "Opus 5.5",
  description: "",
  efforts: [],
};

it("keeps Cursor Fast capability in the phone catalog and uses it for /fast", async () => {
  const grok: AgentModel = {
    id: "grok-4.7",
    name: "Grok",
    description: "",
    efforts: ["high"],
    fast: true,
  };
  const { desktop } = desktopAnswering([grok]);
  const lists = await loadModelLists(desktop, ["cursor"]);
  expect(supportsFast("cursor", grok.id, knownModels(desktop).cursor)).toBe(
    true,
  );
  expect(
    composerCommand("fast", "on", {
      recipient: "cursor",
      targets: ["cursor"],
      model: grok.id,
      fast: false,
      plan: false,
      catalogs: lists,
    }),
  ).toEqual({ command: "fast", fast: true });
  expect(saveModels).toHaveBeenCalledWith(
    expect.objectContaining({ cursor: [grok] }),
  );
});

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

it.each([false, true])(
  "ignores an old connection's answer (new answer first: %s)",
  async (newFirst) => {
    saveModels.mockClear();
    let oldAnswer!: (list: AgentModel[]) => void;
    let newAnswer!: (list: AgentModel[]) => void;
    const ask = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AgentModel[]>((resolve) => {
            oldAnswer = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AgentModel[]>((resolve) => {
            newAnswer = resolve;
          }),
      );
    const desktop = ask as unknown as RemoteClient["desktop"];
    const old = loadModelLists(desktop, ["claude"]);
    newModelConnection();
    const fresh = loadModelLists(desktop, ["claude"]);
    const updated = { ...opus, name: "Updated Opus" };
    if (newFirst) {
      newAnswer([updated]);
      await fresh;
    }
    oldAnswer([opus]);
    await old;
    expect(knownModels(desktop).claude).toEqual(
      newFirst ? [updated] : undefined,
    );
    // The old answer must neither save stale data nor clear the new request.
    const concurrent = loadModelLists(desktop, ["claude"]);
    expect(ask).toHaveBeenCalledTimes(2);
    if (!newFirst) newAnswer([updated]);
    await Promise.all([fresh, concurrent]);
    expect(knownModels(desktop).claude).toEqual([updated]);
    expect(saveModels).toHaveBeenCalledTimes(1);
    expect(saveModels).toHaveBeenLastCalledWith({ claude: [updated] });
  },
);

it("ignores an old answer even before the new connection asks for models", async () => {
  let answer!: (list: AgentModel[]) => void;
  const desktop = (() =>
    new Promise<AgentModel[]>((resolve) => {
      answer = resolve;
    })) as unknown as RemoteClient["desktop"];
  const old = loadModelLists(desktop, ["claude"]);
  newModelConnection();
  answer([opus]);
  await old;
  expect(knownModels(desktop).claude).toBeUndefined();
});
