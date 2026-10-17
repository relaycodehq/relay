import { describe, expect, it, vi } from "vitest";
import type { TurnEvent } from "../../shared/turns";
import { ActiveTurns } from "./active";

const input = { provider: "claude", body: "" } as Parameters<
  ActiveTurns["create"]
>[1];

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
    const ended: TurnEvent[] = [];
    turns.ledger.onEvent((e) => e.type === "ended" && ended.push(e));
    const held = turns.claim("t", input);
    held.answer = () => ({ id: "a", status: "complete" }) as never;
    turns.release("t", held);
    turns.release("t", held);
    expect(ended.map((e) => e.turn)).toEqual([
      expect.objectContaining({
        id: held.turnId,
        endedAs: "completed",
        answerId: "a",
      }),
    ]);
  });

  it("keeps in the ledger whether a turn's agent waits on you", async () => {
    const turns = new ActiveTurns(() => {});
    const held = turns.claim("t", input);
    const asked = held.requests.ask({
      kind: "approval",
      title: "Run the checks?",
      decisions: ["accept"],
    });
    expect(turns.ledger.get(held.turnId)?.blocked).toBe(true);
    const [request] = held.requests.list();
    held.requests.respond(request!.id, { kind: "approval", decision: "accept" });
    await asked;
    expect(turns.ledger.get(held.turnId)?.blocked).toBeUndefined();
  });

  it("gives the thread back when a turn's job settled a sweep ago without releasing it", async () => {
    const turns = new ActiveTurns(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaked = turns.claim("t", input);
    const released = turns.claim("u", input);
    await turns.runs(leaked, Promise.resolve());
    await turns.runs(
      released,
      Promise.resolve().then(() => turns.release("u", released)),
    );
    await new Promise((settle) => setTimeout(settle));
    // One sweep may land between the job settling and its release.
    expect(turns.sweep()).toEqual([]);
    expect(turns.has("t")).toBe(true);
    expect(turns.sweep()).toEqual(["t"]);
    expect(turns.has("t")).toBe(false);
    expect(turns.ledger.inThread("t")).toEqual([]);
    await leaked.ended;
  });
});
