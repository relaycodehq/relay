import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TurnEvent } from "../../shared/turns";
import { openTurnLedger, TurnLedger } from "./ledger";

let dir: string;
let ledgers: TurnLedger[];
const open = () => {
  const ledger = openTurnLedger(join(dir, "relay.db"));
  ledgers.push(ledger);
  return ledger;
};
const heard = (ledger: TurnLedger) => {
  const events: TurnEvent[] = [];
  ledger.onEvent((e) => events.push(e));
  return events;
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-ledger-"));
  ledgers = [];
});
afterEach(async () => {
  for (const ledger of ledgers) ledger.dispose();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const answer = { threadId: "t1", kind: "answer", provider: "codex" } as const;

it("numbers what happens to a turn, in order", () => {
  const ledger = open();
  const events = heard(ledger);
  const turn = ledger.start(answer);
  ledger.phase(turn.id, "running", "m1");
  ledger.end(turn.id, "completed");
  expect(events.map((e) => [e.seq, e.type, e.turn.phase])).toEqual([
    [1, "opened", "starting"],
    [2, "phase", "running"],
    [3, "ended", "ended"],
  ]);
  expect(events[2].turn).toMatchObject({
    endedAs: "completed",
    answerId: "m1",
  });
  expect(ledger.inThread("t1")).toEqual([]);
});

it("ignores word about a turn that already ended, and a stop is final", () => {
  const ledger = open();
  const events = heard(ledger);
  const turn = ledger.start(answer);
  ledger.phase(turn.id, "stopping");
  ledger.phase(turn.id, "finishing");
  expect(ledger.get(turn.id)?.phase).toBe("stopping");
  ledger.end(turn.id, "cancelled");
  ledger.end(turn.id, "completed");
  ledger.phase(turn.id, "running");
  expect(events.map((e) => e.type)).toEqual(["opened", "phase", "ended"]);
  expect(events[2].turn.endedAs).toBe("cancelled");
});

it("recovers the turns a Relay that quit left open, not a running one's", () => {
  const before = open();
  const left = before.start(answer);
  // Quit without ending it: the next launch finds it left over.
  before.dispose();
  ledgers = ledgers.filter((l) => l !== before);
  const running = open();
  const mine = running.start({ ...answer, threadId: "t2" });
  const next = open();
  const events = heard(next);
  next.recover();
  expect(events.map((e) => [e.turn.id, e.turn.endedAs])).toEqual([
    [left.id, "interrupted"],
  ]);
  // Still running in a Relay that's alive: not the next one's to end.
  expect(running.get(mine.id)?.phase).toBe("starting");
  // Recovered once.
  next.recover();
  expect(events).toHaveLength(1);
});

it("ends the turns no one holds any more as lost, and says which threads changed", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ledger = open();
  const held = ledger.start(answer);
  const leaked = ledger.start({ ...answer, threadId: "t2" });
  expect(ledger.check((id) => id === held.id)).toEqual(["t2"]);
  expect(ledger.get(leaked.id)).toBeUndefined();
  expect(ledger.get(held.id)?.phase).toBe("starting");
});

it("goes on when something listening to it fails", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ledger = open();
  ledger.onEvent(() => {
    throw new Error("A listener broke.");
  });
  const events = heard(ledger);
  const turn = ledger.start(answer);
  ledger.end(turn.id, "completed");
  expect(events.map((e) => e.type)).toEqual(["opened", "ended"]);
});

it("keeps turns in memory when its database can't be read", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await writeFile(
    join(dir, "relay.db"),
    "not a database, just bytes ".repeat(200),
  );
  const ledger = open();
  const turn = ledger.start(answer);
  expect(ledger.inThread("t1").map((t) => t.id)).toEqual([turn.id]);
});
