import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { findExecutable } from "../../electron/executables";
import { runCodex } from "../../electron/rooms/codex";
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
  findExecutable: vi.fn(),
}));

// Answers like `codex app-server` whose config.toml sets `model_reasoning_effort = "xhigh"`.
const fakeCodex = (log: string) => `#!${process.execPath}
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "config/read") send({ id: m.id, result: { config: {} } });
  else if (m.method === "thread/start")
    send({ id: m.id, result: { thread: { id: "thread" }, model: "gpt-6-astra", reasoningEffort: "xhigh" } });
  else if (m.method === "turn/start") {
    require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(m.params));
    send({ id: m.id, result: { turn: { id: "turn" } } });
    send({ method: "item/completed", params: { threadId: "thread", item: { id: "a", type: "agentMessage", phase: "final_answer", text: "Done." } } });
    send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
  }
});
`;

it("runs a turn at Codex's own effort when the default is chosen", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-codex-")));
  const cli = join(root, "codex"),
    log = join(root, "turn.json");
  await writeFile(cli, fakeCodex(log), { mode: 0o700 });
  vi.mocked(findExecutable).mockResolvedValue(cli);
  const answer = await runCodex({
    cwd: root,
    prompt: "Hi",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText() {},
  });
  expect(answer).toBe("Done.");
  const turn = JSON.parse(await readFile(log, "utf8"));
  // The collaboration mode's settings win over `effort`.
  expect(turn.collaborationMode.settings).toMatchObject({
    model: "gpt-6-astra",
    reasoning_effort: "xhigh",
  });
});
