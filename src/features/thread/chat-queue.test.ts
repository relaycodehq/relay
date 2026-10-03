import { describe, expect, it } from "vitest";
import { moveQueued } from "./chat-queue";

const queued = (...ids: string[]) => ids.map((id) => ({ input: { id } }));
const order = (moved: ReturnType<typeof moveQueued>) =>
  moved?.queue.map((q) => q.input.id);

describe("moving a queued message", () => {
  const queue = queued("a", "b", "c");
  it("lands before or after the message it's dropped on", () => {
    const after = moveQueued(queue, "a", { id: "c", where: "after" });
    expect(order(after)).toEqual(["b", "c", "a"]);
    expect(after?.index).toBe(2);
    const before = moveQueued(queue, "c", { id: "a", where: "before" });
    expect(order(before)).toEqual(["c", "a", "b"]);
    expect(before?.index).toBe(0);
  });
  it("does nothing when the drop leaves it where it was", () => {
    expect(moveQueued(queue, "b", { id: "b", where: "after" })).toBeUndefined();
    expect(
      moveQueued(queue, "a", { id: "b", where: "before" }),
    ).toBeUndefined();
    expect(moveQueued(queue, "b", { id: "a", where: "after" })).toBeUndefined();
  });
});
