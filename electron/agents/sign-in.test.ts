import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import { findExecutable } from "../platform/executables";
import { agentSignedIn, signInCommand } from "./sign-in";
vi.mock("../platform/executables");

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A CLI whose status check prints `out` and exits with `code`, as the real ones do. */
async function cli(out: string, code: number) {
  dir ??= await mkdtemp(join(tmpdir(), "relay-sign-in-"));
  const path = await fakeCli(
    join(dir, "agent"),
    `process.stdout.write(${JSON.stringify(out)}); process.exit(${code});`,
  );
  vi.mocked(findExecutable).mockResolvedValue(path);
}

it.each([
  [
    "claude",
    '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n',
    0,
    true,
  ],
  ["claude", '{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n', 1, false],
  ["codex", "Logged in using ChatGPT\n", 0, true],
  ["codex", "Not logged in\n", 1, false],
  // A CLI too old to have the check, or one that breaks: it can't tell.
  ["claude", "error: unknown command 'auth'\n", 1, null],
  ["codex", "Error loading configuration\n", 1, null],
] as const)("reads %s saying %j", async (provider, out, code, says) => {
  await cli(out, code);
  expect(await agentSignedIn(provider)).toBe(says);
});

it("can't tell for an agent without a status check, or one that isn't installed", async () => {
  expect(await agentSignedIn("cursor")).toBeNull();
  vi.mocked(findExecutable).mockRejectedValue(new Error("Not found."));
  expect(await agentSignedIn("codex")).toBeNull();
});

it("signs Codex in with a device code when the browser is on another computer", async () => {
  vi.mocked(findExecutable).mockResolvedValue("/usr/local/bin/codex");
  expect(await signInCommand("codex", { away: true })).toBe(
    "/usr/local/bin/codex login --device-auth",
  );
  expect(await signInCommand("codex")).toBe("/usr/local/bin/codex login");
  // Claude's login is left as it is.
  vi.mocked(findExecutable).mockResolvedValue("/usr/local/bin/claude");
  expect(await signInCommand("claude", { away: true })).toBe(
    "/usr/local/bin/claude auth login",
  );
});
