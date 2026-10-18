import type { AgentRuntime } from "../types";
import { closeCatalog, forgetMuseModels, knownMuseCommands, museCommands, museDefaults, museModels } from "./catalog";
import { runMuse } from "./run";
import { closeMuseSession, detachMuse, disposeMuse, reattachMuse } from "./sessions";
import { museSubagentBooks } from "./subagents";

export { readMuseUsage } from "./usage";

/** Meta's Muse Code, driven over its session protocol (`muse serve`). */
export const museRuntime: AgentRuntime = {
  run: runMuse,
  closeSession: async (key) => {
    museSubagentBooks.drop(key);
    await closeMuseSession(key);
  },
  subagents: (key) => museSubagentBooks.get(key),
  models: museModels,
  defaults: () => museDefaults(),
  commands: museCommands,
  knownCommands: knownMuseCommands,
  reloadModels: async () => {
    // Muse reads its catalog at start: a new catalog process asks afresh.
    forgetMuseModels();
    await closeCatalog();
  },
  reattach: (owns) => reattachMuse(owns),
  detach: () => {
    detachMuse();
    void closeCatalog();
  },
  dispose: async () => {
    disposeMuse();
    await closeCatalog();
  },
};
