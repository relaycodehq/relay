import { expect, it } from "vitest";
import { nameChanges, reloadDetail, reloadNote } from "./session-reload";

it("diffs only when both sides are known", () => {
  expect(nameChanges(["compact", "old"], ["compact", "new", "new"])).toEqual({
    added: ["new"],
    removed: ["old"],
  });
  expect(nameChanges(undefined, ["new"])).toBeUndefined();
  expect(nameChanges(["old"], undefined)).toBeUndefined();
});

it("says what a reload picked up and lost, and nothing when it can't tell", () => {
  expect(reloadNote({})).toBe("Session reloaded");
  expect(
    reloadNote({ skills: { added: [], removed: [] }, agents: undefined }),
  ).toBe("Session reloaded");
  expect(reloadNote({ skills: { added: ["a", "b"], removed: [] } })).toBe(
    "Session reloaded · picked up 2 new skills",
  );
  expect(
    reloadNote({
      skills: { added: ["a"], removed: ["c"] },
      agents: { added: ["r"], removed: ["x", "y"] },
    }),
  ).toBe(
    "Session reloaded · picked up 1 new skill and 1 new agent · 1 skill and 2 agents gone",
  );
});

it("names them on hover only when something changed", () => {
  expect(reloadDetail({ skills: { added: [], removed: [] } })).toBeUndefined();
  expect(
    reloadDetail({
      skills: { added: ["release", "deploy"], removed: [] },
      agents: { added: [], removed: ["reviewer"] },
    }),
  ).toBe("New skills: release, deploy\nAgents gone: reviewer");
});
