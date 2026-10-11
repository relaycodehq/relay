import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { row, Screen } from "./terminal-ui";

const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

function terminal(columns = 80) {
  const written: string[] = [];
  const out = {
    isTTY: true,
    columns,
    write: (text: string) => written.push(text),
  };
  const keys = Object.assign(new EventEmitter(), {
    isTTY: true,
    raw: false,
    setRawMode(raw: boolean) {
      this.raw = raw;
    },
    resume() {},
    pause() {},
  });
  return { out, keys, written, press: (k: string) => keys.emit("data", k) };
}

afterEach(() => vi.unstubAllEnvs());

it("lines details up after labels, however long the label", () => {
  expect(plain(row("ok", "Git", "2.39.5"))).toBe("   ✓ Git          2.39.5");
  expect(plain(row("ok", "Claude Code", "2.1.286"))).toBe(
    "   ✓ Claude Code  2.1.286",
  );
  expect(plain(row("warn", "A very long label", "x"))).toBe(
    "   ! A very long label x",
  );
});

it("answers a question with the arrow keys and Enter, or y and n at once, and clears its row", async () => {
  const t = terminal();
  const ui = new Screen(t.out, t.keys);
  const first = ui.ask("Start with this computer?", true);
  expect(t.keys.raw).toBe(true);
  t.press("\x1b[C");
  t.press("\r");
  expect(await first).toBe(false);
  expect(t.keys.raw).toBe(false);
  expect(t.written.at(-2)).toBe("\r\x1b[2K");

  const second = ui.ask("Add it?", false);
  t.press("y");
  expect(await second).toBe(true);
  expect(t.keys.listenerCount("data")).toBe(0);
});

it("takes the fallback without asking when it can't ask", async () => {
  const piped = terminal();
  piped.out.isTTY = false;
  await expect(
    new Screen(piped.out, piped.keys).ask("Start?", true),
  ).resolves.toBe(true);
  const yes = terminal();
  await expect(
    new Screen(yes.out, yes.keys, false).ask("Add it?", false),
  ).resolves.toBe(false);
  vi.stubEnv("TERM", "dumb");
  const dumb = terminal();
  await expect(
    new Screen(dumb.out, dumb.keys).ask("Start?", true),
  ).resolves.toBe(true);
  for (const t of [piped, yes, dumb]) expect(t.written).toEqual([]);
});

it("takes back every row a block printed, wrapped ones counted by the terminal's width", () => {
  const t = terminal(20);
  const ui = new Screen(t.out, t.keys);
  ui.print("kept");
  const block = ui.mark();
  ui.print("two\nrows");
  ui.print("x".repeat(45));
  ui.take(block);
  expect(t.written.at(-1)).toBe("\x1b[5F\x1b[0J");
  // Nothing left to take.
  ui.take(block);
  expect(t.written.at(-1)).toBe("\x1b[5F\x1b[0J");
});

it("leaves what it printed alone when the cursor can't move", () => {
  const t = terminal();
  t.out.isTTY = false;
  const ui = new Screen(t.out, t.keys);
  const block = ui.mark();
  ui.print("code");
  ui.take(block);
  ui.spin("Waiting").stop();
  expect(t.written).toEqual(["code\n"]);
});
