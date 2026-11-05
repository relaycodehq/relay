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
  pause() {}
  resume() {}
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
  expect(sent).toEqual([{ key: "thread-c", data: "still here\r\n" }]);
});
