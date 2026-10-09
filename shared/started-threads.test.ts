import { describe, expect, it } from "vitest";
import type { AgentActivity, AgentProvider, ChatMessage } from "./projects";
import type { FamilyMember } from "./started-families";
import {
  slotLine,
  startGroups,
  startedIds,
  startedNow,
  startedOf,
} from "./started-threads";

type Child = FamilyMember & { provider?: AgentProvider };
const child = (id: string, patch: Partial<Child> = {}): Child => ({
  id,
  created: 2_000,
  startedBy: { chatId: "lead", agent: "codex" },
  ...patch,
});

const start = (id: string, detail?: string, patch: Partial<AgentActivity> = {}): AgentActivity => ({
  id,
  kind: "tool",
  status: "complete",
  label: "Started threads",
  mcp: { server: "relay", tool: "start_threads" },
  ...(detail === undefined ? {} : { detail }),
  ...patch,
});

const turn = (calls: AgentActivity[], patch: Partial<ChatMessage> = {}) => ({
  created: 1_000,
  ended: 5_000,
  trace: calls.map((activity) => ({ kind: "activity" as const, id: activity.id, activity })),
  ...patch,
});

const result = (...ids: string[]) =>
  JSON.stringify(ids.map((id) => ({ id, title: id, agent: "codex", worktree: true })), null, 1);

describe("startedIds", () => {
  it("reads the ids, skipping the threads that failed to start", () => {
    expect(startedIds(JSON.stringify([{ id: "a" }, { error: "bad model" }, { id: "b" }]))).toEqual(["a", "b"]);
  });

  it("gives up on an error message or a result cut short", () => {
    expect(startedIds("The user didn't start these threads.")).toBeUndefined();
    expect(startedIds(result("a", "b").slice(0, 40))).toBeUndefined();
    expect(startedIds(JSON.stringify([{ error: "bad model" }]))).toBeUndefined();
  });
});

describe("startedOf", () => {
  it("lists the lead's threads: needs you, then working, then done, each oldest first", () => {
    const listed = startedOf("lead", [
      child("done", { created: 1 }),
      child("other", { startedBy: { chatId: "elsewhere", agent: "codex" } }),
      child("working-late", { running: true, created: 9 }),
      child("asks", { waiting: true, created: 5 }),
      child("working-early", { running: true, created: 2 }),
      { id: "plain", created: 0 },
    ]);
    expect(listed.map((c) => c.id)).toEqual(["asks", "working-early", "working-late", "done"]);
  });
});

describe("startGroups", () => {
  const threads = [child("a", { created: 2_000 }), child("b", { created: 2_100, waiting: true }), child("c", { created: 9_000 })];

  it("gives each call the threads its result names", () => {
    const groups = startGroups(turn([start("s1", result("a")), start("s2", result("b", "c"))]), threads);
    expect(groups.map((g) => [g.id, g.count, g.threads.map((c) => c.id)])).toEqual([
      ["s1", 1, ["a"]],
      ["s2", 2, ["b", "c"]],
    ]);
  });

  it("counts what it started even before the threads show up in the list", () => {
    expect(startGroups(turn([start("s1", result("a", "x", "y"))]), threads)[0]).toMatchObject({ count: 3 });
  });

  it("falls back to the threads started while the turn ran when a result can't be read", () => {
    // Codex keeps no result; an older desktop cuts a long one for the phone.
    for (const detail of [undefined, result("a", "b")]) {
      const call = start("s1", detail, detail ? { detailCut: 300 } : {});
      const groups = startGroups(turn([call]), threads);
      expect(groups.map((g) => [g.id, g.count, g.threads.map((c) => c.id)])).toEqual([["s1", 2, ["b", "a"]]]);
    }
  });

  it("keeps a live turn's window open", () => {
    expect(startGroups(turn([start("s1")], { ended: undefined }), threads)[0]?.threads).toHaveLength(3);
  });

  it("shows nothing for a turn without a call that went through", () => {
    expect(startGroups(turn([]), threads)).toEqual([]);
    expect(startGroups(turn([start("s1", undefined, { status: "failed" })]), threads)).toEqual([]);
    expect(startGroups(turn([start("s1")], { created: 10_000, ended: 11_000 }), threads)).toEqual([]);
  });
});

describe("slotLine", () => {
  it("says how the family stands", () => {
    expect(
      slotLine([child("a", { running: true }), child("b", { running: true }), child("c", { waiting: true }), child("d")]),
    ).toBe("4 threads · 2 working · 1 needs you");
    expect(slotLine([child("a"), child("b")])).toBe("2 threads · all done");
  });

  it("covers the subagents too in the one line", () => {
    expect(slotLine([child("a", { running: true }), child("b", { running: true }), child("c")], 3)).toBe(
      "3 agents · 2 threads working",
    );
    expect(slotLine([child("a", { waiting: true }), child("b")], 1)).toBe("1 agent · 1 thread needs you");
    expect(slotLine([child("a", { running: true }), child("b", { waiting: true })], 2)).toBe(
      "2 agents · 1 thread working · 1 needs you",
    );
  });
});

describe("startedNow", () => {
  const answer = (body: string, patch: Partial<ChatMessage> = {}) => ({ body, status: "complete" as const, ...patch });

  it("names what a waiting thread asks", () => {
    expect(startedNow(child("a", { waiting: true }), { request: "Which approach should the plan use?" })).toEqual({
      tone: "asks",
      text: "Needs you: Which approach should the plan use?",
    });
    expect(startedNow(child("a", { waiting: true, running: true }), {}).text).toBe("Needs you");
  });

  it("gives a working thread's running call, else its latest line", () => {
    const running = child("a", { running: true, provider: "codex" });
    const call: AgentActivity = { id: "c", kind: "command", status: "running", label: "npm test" };
    expect(
      startedNow(running, {
        answer: answer("Checking", { status: "streaming", trace: [{ kind: "activity", id: "c", activity: call }] }),
      }).text,
    ).toBe("Codex · Running npm");
    expect(startedNow(running, { answer: answer("First I read it.\n\n**Now** fixing the guard\n", { status: "streaming" }) }).text).toBe(
      "Codex · Now fixing the guard",
    );
    expect(startedNow(running, {}).text).toBe("Codex · Starting…");
  });

  it("opens a finished thread's answer, or says how it ended", () => {
    expect(startedNow(child("a"), { answer: answer("The cache guard is **fixed**.\n\n- added a test") }).text).toBe(
      "Done: The cache guard is fixed. added a test",
    );
    expect(startedNow(child("a"), { answer: answer("", { status: "failed" }) }).text).toBe("Failed");
    expect(startedNow(child("a"), {}).text).toBe("Done");
  });
});
