import { describe, expect, it, vi } from "vitest";
import { UNDO_MS, undoStack } from "./undo";

describe("undoStack", () => {
  it("never runs an undo once a newer action claimed the same thread", async () => {
    const stack = undoStack();
    const settleUndo = vi.fn(async () => {});
    const settle = stack.claim(["a"]);
    stack.offer(settle, ["a"], settleUndo);
    const snooze = stack.claim(["a"]);
    stack.offer(snooze, ["a"], async () => {});
    expect(stack.list().map((u) => u.token)).toEqual([snooze]);
    expect(await stack.undo(settle)).toBe(false);
    expect(settleUndo).not.toHaveBeenCalled();
  });

  it("doesn't offer an undo whose action was overtaken before it was offered", () => {
    const stack = undoStack();
    const settle = stack.claim(["a"]);
    stack.claim(["a"]);
    stack.offer(settle, ["a"], async () => {});
    expect(stack.list()).toEqual([]);
  });

  it("keeps undos of other threads, and runs the newest first", async () => {
    const stack = undoStack();
    const ran: string[] = [];
    for (const id of ["a", "b"]) {
      const token = stack.claim([id]);
      stack.offer(token, [id], async () => void ran.push(id));
    }
    expect(await stack.undo()).toBe(true);
    expect(await stack.undo()).toBe(true);
    expect(await stack.undo()).toBe(false);
    expect(ran).toEqual(["b", "a"]);
  });

  it("runs an undo once, even pressed twice before it finishes", async () => {
    const stack = undoStack();
    let finish = () => {};
    const run = vi.fn(() => new Promise<void>((done) => (finish = done)));
    const token = stack.claim(["a"]);
    stack.offer(token, ["a"], run);
    const first = stack.undo(token);
    expect(await stack.undo(token)).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("drops a batch's one undo when any of its threads moves on", () => {
    const stack = undoStack();
    const batch = stack.claim(["a", "b"]);
    stack.offer(batch, ["a", "b"], async () => {});
    stack.claim(["b"]);
    expect(stack.list()).toEqual([]);
  });

  it("lets an undo go when its time is up", () => {
    const stack = undoStack();
    const token = stack.claim(["a"]);
    stack.offer(token, ["a"], async () => {}, 0);
    stack.expire(UNDO_MS - 1);
    expect(stack.list()).toHaveLength(1);
    stack.expire(UNDO_MS);
    expect(stack.list()).toEqual([]);
  });
});
