import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { TurnEvent } from "../../shared/turns";
import { TurnLedger } from "./ledger";
import { openTurnStore } from "./store";

let dir: string;
let ledgers: TurnLedger[];
const open = () => {
  const ledger = new TurnLedger(openTurnStore(join(dir, "relay.db")));
  ledgers.push(ledger);
  return ledger;
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-ledger-"));
  ledgers = [];
});
afterEach(async () => {
  for (const ledger of ledgers) ledger.dispose();
  await rm(dir, { recursive: true, force: true });
});
const answer = { threadId: "t1", kind: "answer", provider: "codex" } as const;

it("numbers what happens to a turn and lets a client catch up from a number", () => {
  const ledger = open();
  const heard: TurnEvent[] = [];
  ledger.onEvent((e) => heard.push(e));
  const turn = ledger.start(answer);
  ledger.phase(turn.id, "running", "m1");
  ledger.end(turn.id, "completed");
  expect(heard.map((e) => [e.seq, e.type, e.turn.phase])).toEqual([
    [1, "opened", "starting"],
    [2, "phase", "running"],
    [3, "ended", "ended"],
  ]);
  expect(ledger.since(1)?.map((e) => e.seq)).toEqual([2, 3]);
  expect(ledger.since(3)).toEqual([]);
  // A number from another database can't be caught up from.
  expect(ledger.since(99)).toBeUndefined();
  expect(ledger.lastTurn("t1")).toMatchObject({
    id: turn.id,
    endedAs: "completed",
    answerId: "m1",
  });
});

it("ignores word about a turn that already ended, and a stop is final", () => {
  const ledger = open();
  const turn = ledger.start(answer);
  ledger.phase(turn.id, "stopping");
  ledger.phase(turn.id, "finishing");
  expect(ledger.get(turn.id)?.phase).toBe("stopping");
  ledger.end(turn.id, "cancelled");
  const seq = ledger.seq();
  ledger.end(turn.id, "completed");
  ledger.phase(turn.id, "running");
  expect(ledger.seq()).toBe(seq);
  expect(ledger.lastTurn("t1")?.endedAs).toBe("cancelled");
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
  next.recover();
  expect(next.lastTurn("t1")).toMatchObject({
    id: left.id,
    endedAs: "interrupted",
  });
  // Still running in a Relay that's alive: not the next one's to end.
  expect(next.lastTurn("t2")).toBeUndefined();
  expect(running.get(mine.id)?.phase).toBe("starting");
});

it("ends a turn nothing holds any more as lost", () => {
  const ledger = open();
  const kept = ledger.start(answer);
  const leaked = ledger.start({ ...answer, threadId: "t2" });
  ledger.check((id) => id === kept.id);
  expect(ledger.get(kept.id)).toBeDefined();
  expect(ledger.lastTurn("t2")).toMatchObject({
    id: leaked.id,
    endedAs: "lost",
  });
});
