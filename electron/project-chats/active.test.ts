import { describe, expect, it } from "vitest";
import { ActiveTurns } from "./active";

const input = { provider: "claude", body: "" } as Parameters<ActiveTurns["create"]>[1];

describe("ActiveTurns", () => {
  it("stops a turn the agent started beside the one holding the thread", () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    const rider = turns.create("t", input, "adopt", { rides: true });
    turns.stop("t");
    expect(held.abort.signal.aborted).toBe(true);
    expect(rider.abort.signal.aborted).toBe(true);
    expect(turns.ledger.get(rider.turnId)?.phase).toBe("stopping");
  });

  it("still stops it once the holding turn has given the thread back", async () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    const rider = turns.create("t", input, "adopt", { rides: true });
    turns.release("t", held);
    turns.stop("t");
    expect(rider.abort.signal.aborted).toBe(true);
    const halted = turns.halt("t");
    turns.release("t", rider);
    await halted;
    expect(turns.ledger.inThread("t")).toEqual([]);
  });

  it("ends each turn in the ledger once, as its answer ended", () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    held.answer = () => ({ id: "a", status: "complete" }) as never;
    turns.release("t", held);
    turns.release("t", held);
    expect(turns.ledger.lastTurn("t")).toMatchObject({
      id: held.turnId,
      endedAs: "completed",
      answerId: "a",
    });
    expect(turns.ledger.seq()).toBe(2);
  });
});
