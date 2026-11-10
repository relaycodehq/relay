import Module from "node:module";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalEvent } from "../../shared/terminals";
import { ThreadTerminals } from "./thread-terminals";

vi.mock("./tasks", () => ({
  projectTasks: { trackTerminal: () => {}, untrackTerminal: () => {} },
}));

/** A stand-in pty: the test says when it prints. */
class FakePty {
  static made: FakePty[] = [];
  pid = 5_000_000 + FakePty.made.length;
  process = "zsh";
  killed = false;
  paused = false;
  private data?: (d: string) => void;

  constructor() {
    FakePty.made.push(this);
  }

  onData(cb: (d: string) => void) {
    this.data = cb;
  }

  onExit() {}

  print(d: string) {
    this.data?.(d);
  }

  kill() {
    this.killed = true;
  }

  resize() {}

  write() {}

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }
}

const load = (Module as any)._load;

(Module as any)._load = function (request: string, ...rest: unknown[]) {
  if (/[/\\]node-pty$/.test(request)) return { spawn: () => new FakePty() };
  return load.call(this, request, ...rest);
};

afterAll(() => {
  (Module as any)._load = load;
});

// Output goes out a few milliseconds after the shell prints it.
beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

it("doesn't draw the old shell's last output in the new one a restart started", () => {
  const terminals = new ThreadTerminals();
  const sent: TerminalEvent[] = [];
  terminals.connect((e) => sent.push(e));
  terminals.open("thread-a", "/p", 80, 24);
  const old = FakePty.made.at(-1)!;
  old.print("before\r\n");
  vi.advanceTimersByTime(10);
  sent.length = 0;

  // Restart: the old shell is killed, a new one starts under the same key.
  terminals.open("thread-a", "/p", 80, 24, true);
  expect(old.killed).toBe(true);
  // The killed shell's job still prints on its way out.
  old.print("old server shutting down\r\n");
  vi.advanceTimersByTime(10);

  expect(sent.map((e) => e.data ?? "").join("")).not.toContain(
    "old server shutting down",
  );
});

it("doesn't send output of a shell whose tab was closed", () => {
  const terminals = new ThreadTerminals();
  const sent: TerminalEvent[] = [];
  terminals.connect((e) => sent.push(e));
  terminals.open("thread-b", "/p", 80, 24);
  const old = FakePty.made.at(-1)!;
  terminals.close("thread-b");
  old.print("late\r\n");
  vi.advanceTimersByTime(10);
  expect(sent).toEqual([]);
});

it("keeps sending a draft's shell output once its thread has adopted it", () => {
  const terminals = new ThreadTerminals();
  const sent: TerminalEvent[] = [];
  terminals.connect((e) => sent.push(e));
  terminals.open("draft:p", "/p", 80, 24);
  const shell = FakePty.made.at(-1)!;
  terminals.adopt("draft:p", "thread-c");
  shell.print("still here\r\n");
  vi.advanceTimersByTime(10);
  expect(sent).toEqual([{ key: "thread-c", data: "still here\r\n", seq: 12 }]);
});

/** Opens a shell for each viewer and records what each was sent. */
function shared(...viewers: number[]) {
  const terminals = new ThreadTerminals();
  const sent = new Map<number | undefined, TerminalEvent[]>();
  terminals.connect((e, viewer) =>
    sent.set(viewer, [...(sent.get(viewer) ?? []), e]),
  );
  for (const viewer of viewers)
    terminals.open("thread-d", "/p", 80, 24, false, {}, viewer);
  return { terminals, sent, shell: FakePty.made.at(-1)! };
}

const flood = (shell: FakePty, bytes: number) => {
  shell.print("x".repeat(bytes));
  vi.advanceTimersByTime(10);
};

it("sends a shell's output only to the windows that opened it", () => {
  const { shell, sent } = shared(1, 2);
  shell.print("hi");
  vi.advanceTimersByTime(10);
  expect([...sent.keys()].sort()).toEqual([1, 2]);
});

it("pauses a shell while a window that opened it is behind, whoever else acks", () => {
  // Window 3 never opened the shell, so its acks mean nothing to it.
  const { terminals, shell } = shared(1, 2);
  flood(shell, 3 * 1024 * 1024);
  expect(shell.paused).toBe(true);

  terminals.ack("thread-d", 3 * 1024 * 1024, 1);
  terminals.ack("thread-d", 3 * 1024 * 1024, 3);
  expect(shell.paused).toBe(true);

  terminals.ack("thread-d", 3 * 1024 * 1024, 2);
  expect(shell.paused).toBe(false);
});

it("lets a shell go once the window that was behind is gone", () => {
  const { terminals, shell } = shared(1, 2);
  flood(shell, 3 * 1024 * 1024);
  terminals.ack("thread-d", 3 * 1024 * 1024, 1);
  expect(shell.paused).toBe(true);

  terminals.detach(2);
  expect(shell.paused).toBe(false);
});

it("doesn't pause a shell nobody draws, and keeps its output for the next open", () => {
  const { terminals, shell, sent } = shared(1);
  terminals.detach(1);
  sent.clear();
  flood(shell, 3 * 1024 * 1024);
  expect(shell.paused).toBe(false);
  expect(sent.size).toBe(0);
  const reopened = terminals.open("thread-d", "/p", 80, 24, false, {}, 2);
  expect(reopened.backlog).toContain("xxxx");
});

it("keeps sending a restarted shell's output to the windows that drew the old one", () => {
  const { terminals, sent } = shared(1, 2);
  terminals.open("thread-d", "/p", 80, 24, true, {}, 1);
  sent.clear();
  FakePty.made.at(-1)!.print("new");
  vi.advanceTimersByTime(10);
  expect([...sent.keys()].sort()).toEqual([1, 2]);
});

it("sends output still waiting to the windows already drawing when another opens", () => {
  const { terminals, shell, sent } = shared(1);
  shell.print("waiting");
  terminals.open("thread-d", "/p", 80, 24, false, {}, 2);
  expect(sent.get(1)?.map((e) => e.data)).toEqual(["waiting"]);
});

it("numbers output so a window can tell what its backlog already holds", () => {
  const { terminals, shell, sent } = shared(1);
  shell.print("A");
  vi.advanceTimersByTime(10);
  shell.print("B");
  vi.advanceTimersByTime(10);
  expect(sent.get(1)?.map((e) => e.seq)).toEqual([1, 2]);

  const reopened = terminals.open("thread-d", "/p", 80, 24, false, {}, 2);
  expect(reopened).toMatchObject({ backlog: "AB", seq: 2 });
});

it("counts output still waiting when a window opens as part of its backlog", () => {
  const { terminals, shell } = shared(1);
  shell.print("AB");
  expect(terminals.open("thread-d", "/p", 80, 24, false, {}, 2).seq).toBe(2);
});
