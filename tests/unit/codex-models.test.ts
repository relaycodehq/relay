import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { findExecutable } from "../../electron/executables";
import { codexModels } from "../../electron/provider-commands";
import {
  reasoningEffortsFor,
  supportedChoice,
  supportsEffort,
} from "../../shared/settings";
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
  findExecutable: vi.fn(),
}));

// Answers like `codex app-server`: two pages, one hidden and one legacy model.
// Signed out, it still lists the few models built into the CLI.
const fakeCodex = (log: string, auth: string) => `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(log)}, "launch\\n");
const signedIn = require("node:fs").existsSync(${JSON.stringify(auth)});
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
const efforts = (...names) => names.map((reasoningEffort) => ({ reasoningEffort }));
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "account/read")
    send({ id: m.id, result: { account: signedIn ? { type: "chatgpt" } : null, requiresOpenaiAuth: true } });
  else if (m.method === "model/list" && !signedIn)
    send({ id: m.id, result: { nextCursor: null, data: [
      { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", hidden: false,
        upgrade: null, supportedReasoningEfforts: efforts("low") },
    ] } });
  else if (m.method === "model/list" && !m.params.cursor)
    send({ id: m.id, result: { nextCursor: "2", data: [
      { id: "gpt-6-sol", model: "gpt-6-sol", displayName: "GPT-6-Sol",
        description: "Workhorse model.", hidden: false, upgrade: null,
        supportedReasoningEfforts: efforts("low", "medium", "ultra", "turbo") },
      { id: "codex-auto-review", model: "codex-auto-review", hidden: true,
        supportedReasoningEfforts: [] },
    ] } });
  else if (m.method === "model/list")
    send({ id: m.id, result: { nextCursor: null, data: [
      { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5",
        description: "Legacy coding model.", hidden: false,
        upgrade: "gpt-5.6-sol", supportedReasoningEfforts: efforts("low") },
      { id: "not a valid id!", hidden: false },
    ] } });
});
`;

it("lists the signed-in Codex models once, and asks again after a failure or signed out", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-models-")));
  const broken = join(root, "broken");
  await writeFile(broken, `#!${process.execPath}\nprocess.exit(1);\n`, {
    mode: 0o700,
  });
  vi.mocked(findExecutable).mockResolvedValue(broken);
  await expect(codexModels()).rejects.toThrow();

  const cli = join(root, "codex"),
    log = join(root, "launches"),
    auth = join(root, "auth.json");
  await writeFile(cli, fakeCodex(log, auth), { mode: 0o700 });
  vi.mocked(findExecutable).mockResolvedValue(cli);
  await expect(codexModels()).rejects.toThrow("Sign in to Codex");

  await writeFile(auth, "{}");
  const models = await codexModels();
  expect(models).toEqual([
    {
      id: "gpt-6-sol",
      name: "GPT-6-Sol",
      description: "Workhorse model.",
      efforts: ["low", "medium", "ultra"],
      legacy: false,
    },
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      description: "Legacy coding model.",
      efforts: ["low"],
      legacy: true,
    },
  ]);
  expect(await codexModels()).toBe(models);
  expect(await readFile(log, "utf8")).toBe("launch\n".repeat(2));

  // Listed efforts win; unlisted models keep the built-in or open fallback.
  expect(reasoningEffortsFor("gpt-5.5", models)).toEqual(["low"]);
  expect(reasoningEffortsFor("gpt-6-luna", models)).not.toContain("ultra");
  expect(
    supportsEffort({ model: "gpt-5.5", reasoningEffort: "high" }, models),
  ).toBe(false);
  expect(
    supportsEffort({ model: "my-custom-model", reasoningEffort: "ultra" }),
  ).toBe(true);
  // A saved effort the model no longer lists runs as its default.
  const saved = {
    model: "gpt-5.5",
    fast: true,
    reasoningEffort: "high" as const,
  };
  expect(supportedChoice(saved, models)).toEqual({
    ...saved,
    reasoningEffort: "",
  });
  const low = { ...saved, reasoningEffort: "low" as const };
  expect(supportedChoice(low, models)).toBe(low);
});
