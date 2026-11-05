// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { TerminalOpened } from "../../../shared/terminals";
import { api } from "../../lib/api";
import {
  closeTerminal,
  forgetThreadTerminals,
  terminalFor,
} from "./thread-terminals";

vi.mock("../../lib/api", () => ({
  api: {
    onTerminal: vi.fn(),
    openTerminal: vi.fn(),
    closeTerminal: vi.fn(async () => {}),
    resizeTerminal: vi.fn(async () => {}),
    writeTerminal: vi.fn(async () => {}),
    ackTerminal: vi.fn(async () => {}),
  },
}));

afterEach(() => vi.clearAllMocks());

it("ends a shell that finished starting after its tab was closed", async () => {
  let opened!: (value: TerminalOpened) => void;
  vi.mocked(api.openTerminal).mockReturnValue(
    new Promise((resolve) => (opened = resolve)),
  );
  const terminal = terminalFor("project", "chat", "two");
  const starting = terminal.start();
  closeTerminal("project", "chat", "two");
  expect(api.closeTerminal).toHaveBeenCalledTimes(1);

  opened({ cwd: "/repo", backlog: "" });
  await starting;

  expect(api.closeTerminal).toHaveBeenCalledTimes(2);
  expect(api.closeTerminal).toHaveBeenLastCalledWith("chat~two");
});

it("leaves the shell to a tab that took its place meanwhile", async () => {
  let opened!: (value: TerminalOpened) => void;
  vi.mocked(api.openTerminal).mockReturnValueOnce(
    new Promise((resolve) => (opened = resolve)),
  );
  const first = terminalFor("project", "chat");
  const starting = first.start();
  // Typed while it started, then the tab closed: none of it is the new tab's.
  (first as unknown as { term: { input(data: string): void } }).term.input(
    "rm -rf build\r",
  );
  closeTerminal("project", "chat", "");
  terminalFor("project", "chat");

  opened({ cwd: "/repo", backlog: "" });
  await starting;

  expect(api.closeTerminal).toHaveBeenCalledTimes(1);
  expect(api.writeTerminal).not.toHaveBeenCalled();
});

it("sends a paste too big for one write in pieces, none of it lost", async () => {
  vi.mocked(api.openTerminal).mockResolvedValue({ cwd: "/repo", backlog: "" });
  const terminal = terminalFor("project", "paste");
  await terminal.start();
  const pasted = `${"a".repeat((1 << 20) - 1)}😀${"b".repeat(300_000)}`;

  (terminal as unknown as { term: { input(data: string): void } }).term.input(
    pasted,
  );

  const writes = vi
    .mocked(api.writeTerminal)
    .mock.calls.map(([, data]) => data);
  expect(writes.every((data) => data.length <= 1 << 20)).toBe(true);
  expect(writes.join("")).toBe(pasted);
  expect(writes[0].endsWith("a")).toBe(true);
});

it("lets go of a deleted thread's shells, each delete leaving none behind", () => {
  const kept = [];
  for (let round = 0; round < 5; round++) {
    const chatId = `deleted-${round}`;
    const shells = [
      terminalFor("project", chatId),
      terminalFor("project", chatId, "two"),
    ];
    for (const shell of shells) document.body.append(shell.element);
    const disposes = shells.map((shell) => vi.spyOn(shell.term, "dispose"));

    forgetThreadTerminals(chatId);

    for (const dispose of disposes) expect(dispose).toHaveBeenCalledTimes(1);
    for (const shell of shells) expect(shell.element.isConnected).toBe(false);
    expect(terminalFor("project", chatId)).not.toBe(shells[0]);
    kept.push(terminalFor("project", "other"));
  }
  expect(new Set(kept).size).toBe(1);
});
