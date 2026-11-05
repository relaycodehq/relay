import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ApiContext } from "./context";
import { gitHandlers } from "./git";

vi.mock("../git/branches", () => ({
  changeBranch: vi.fn(async () => ({ branch: "feature" })),
}));

it("stops only the switched checkout's live checks, not every project's", async () => {
  const projectId = randomUUID();
  const stop = vi.fn();
  const ctx = {
    projects: {
      assertCheckoutAvailable: () => {},
      changingBranch: new Set<string>(),
      root: async () => "/repo",
    },
    projectChats: { hasActiveProject: () => false },
    projectChecks: { stop },
  } as unknown as ApiContext;

  await gitHandlers(ctx).projectChangeBranch([
    projectId,
    { kind: "switch", name: "feature", current: "main", head: "a".repeat(40) },
  ]);

  expect(stop.mock.calls).toEqual([[`project:${projectId}`]]);
});
