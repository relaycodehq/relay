import { describe, expect, it } from "vitest";
import { ActiveTurns } from "./active";

const input = {} as Parameters<ActiveTurns["create"]>[1];

describe("ActiveTurns", () => {
  it("stops a turn the agent started beside the one holding the thread", () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    const rider = turns.create("t", input);
    turns.ride("t", rider);
    turns.stop("t");
    expect(held.abort.signal.aborted).toBe(true);
    expect(rider.abort.signal.aborted).toBe(true);
  });

  it("still stops it once the holding turn has given the thread back", async () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    const rider = turns.create("t", input);
    const unride = turns.ride("t", rider);
    turns.release("t", held);
    turns.stop("t");
    expect(rider.abort.signal.aborted).toBe(true);
    const halted = turns.halt("t");
    unride();
    rider.end();
    await halted;
  });
});
