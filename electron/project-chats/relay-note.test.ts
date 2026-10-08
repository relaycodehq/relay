import { expect, it } from "vitest";
import type { AgentActivity, ChatMessage } from "../../shared/projects";
import { relayNote } from "./relay-note";

let n = 0;
const message = (m: Partial<ChatMessage>): ChatMessage => ({
  id: `m${++n}`,
  role: "assistant",
  body: "",
  status: "complete",
  created: n,
  provider: "claude",
  version: 1,
  ...m,
});
const call = (
  kind: AgentActivity["kind"],
  label: string,
  status: AgentActivity["status"] = "complete",
) => ({
  kind: "activity" as const,
  id: `a${++n}`,
  activity: { id: `a${n}`, kind, label, status },
});

it("lists what the outgoing agent touched and where its cut-off turn stopped", () => {
  const note = relayNote(
    [
      message({ role: "user", body: "Make the cache survive restarts" }),
      message({
        body: "Looked at the cache.",
        trace: [call("read", "src/cache.ts"), call("read", "src/store.ts")],
      }),
      message({ role: "user", body: "Go ahead" }),
      message({
        status: "failed",
        error: "You've hit your usage limit.",
        body: "Writing the loader now",
        changes: [
          { path: "src/cache.ts", additions: 4, deletions: 1 },
          {
            path: "src/undone.ts",
            additions: 1,
            deletions: 0,
            revertedBy: "s",
          },
        ],
        trace: [
          call("command", "npm test -- cache", "failed"),
          {
            kind: "commentary",
            id: "c",
            text: "The loader needs a version key.",
          },
          call("file", "src/loader.ts", "running"),
        ],
      }),
      // Another agent's work and markers aren't the outgoing agent's.
      message({ provider: "codex", trace: [call("read", "src/codex.ts")] }),
      message({ handoff: { from: "claude", to: "codex" }, body: "old note" }),
    ],
    "claude",
  );
  expect(note).toContain("Make the cache survive restarts");
  expect(note).toMatch(/changed:\n- src\/cache\.ts\n\n/);
  // Read and later changed is listed as changed only.
  expect(note).toMatch(/read:\n- src\/store\.ts\n\n/);
  expect(note).toContain("- npm test -- cache  (failed)");
  expect(note).toContain(
    "didn't finish (failed: You've hit your usage limit.)",
  );
  expect(note).toContain(
    "The last thing it said: The loader needs a version key.",
  );
  expect(note).toContain("Its last call: file src/loader.ts (running).");
  expect(note).toContain("ended with: Writing the loader now");
  for (const left of ["src/undone.ts", "src/codex.ts", "old note"])
    expect(note).not.toContain(left);
});

it("says nothing about a last turn that finished", () => {
  const note = relayNote(
    [message({ role: "user", body: "Hi" }), message({ body: "Hello" })],
    "claude",
  );
  expect(note).not.toContain("didn't finish");
});
