import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classifyChanges } from "./classifier";
import { prepareCandidate, type Candidate } from "./evidence";
import { spawnExecutable } from "../platform/executables";
import { terminate } from "../platform/terminate";

vi.mock("../platform/executables", () => ({
  findExecutable: async () => "fixture-codex",
  spawnExecutable: vi.fn(),
}));
vi.mock("../platform/terminate", () => ({ terminate: vi.fn() }));
vi.mock("../agents/accounts", () => ({
  runAccount: async () => ({ env: {} }),
}));

const candidate = prepareCandidate(
  {
    filename: "a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
  },
  {
    old: { name: "a.ts", contents: "old();", cacheKey: "old" },
    next: { name: "a.ts", contents: "next();", cacheKey: "next" },
    binary: false,
  },
) as Candidate;
let child: ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
};
beforeEach(() => {
  child = Object.assign(new ChildProcess(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
  });
  vi.mocked(spawnExecutable).mockReturnValue(child);
  vi.mocked(terminate).mockImplementation(() => {
    setImmediate(() => child.emit("close", null));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("stops the whole classifier process tree on cancellation and keeps its error", async () => {
  const abort = new AbortController();
  const result = classifyChanges([candidate], [], abort.signal);
  const rejected = expect(result).rejects.toThrow("Analysis cancelled.");
  await vi.waitFor(() => expect(spawnExecutable).toHaveBeenCalled());
  abort.abort();
  child.stdout.write("not JSON\n");
  await rejected;
  expect(terminate).toHaveBeenCalledExactlyOnceWith(child, { group: true });
});

it("stops the whole classifier process tree when the batch times out", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const result = classifyChanges([candidate], [], new AbortController().signal);
  const rejected = expect(result).rejects.toThrow(
    "Codex timed out. This batch is saved for retry; earlier decisions are kept.",
  );
  await vi.waitFor(() => expect(spawnExecutable).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(90_000);
  await rejected;
  expect(terminate).toHaveBeenCalledExactlyOnceWith(child, { group: true });
});

it("stops an unexpected tool operation without replacing its failure on exit", async () => {
  const result = classifyChanges([candidate], [], new AbortController().signal);
  const rejected = expect(result).rejects.toThrow(
    "Codex emitted an unexpected command_execution item; classification was stopped.",
  );
  await vi.waitFor(() => expect(spawnExecutable).toHaveBeenCalled());
  child.stdout.write(
    JSON.stringify({ item: { type: "command_execution" } }) + "\n",
  );
  await rejected;
  expect(terminate).toHaveBeenCalledExactlyOnceWith(child, { group: true });
});
