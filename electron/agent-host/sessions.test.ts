import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const spawned = vi.hoisted(
  () => [] as { command: string; args: string[]; options: unknown }[],
);

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[], options: unknown) => {
    spawned.push({ command, args, options });
    return Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      stdin: Object.assign(new PassThrough(), { end: () => {} }),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
  },
}));

const { ProcessSession } = await import("./sessions");

const host = {
  deliver: () => {},
  ask: async () => undefined as never,
  asking: () => false,
};

const platform = process.platform;

beforeEach(() => {
  spawned.length = 0;
  Object.defineProperty(process, "platform", { value: "win32" });
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
});

it("stops a grouped process with everything it started on Windows", () => {
  const session = new ProcessSession("s1", "acp:thread", {}, host);
  session.launch({
    command: "opencode",
    args: ["acp"],
    cwd: "C:\\work\\acme",
    env: {},
    group: true,
  });

  session.close();

  expect(spawned[0].options).toMatchObject({ detached: false });
  expect(spawned[1]).toMatchObject({
    command: "taskkill",
    args: ["/PID", "4242", "/T", "/F"],
  });
});
