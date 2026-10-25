import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { openCodeAuthFixture } from "../../../tests/fixtures/opencode-auth";
import { setLinkedAgents } from "../../platform/executables";
import { openCodeAuth, openCodeAuthProviders } from "./auth";

let root: string;
let fixture: Awaited<ReturnType<typeof openCodeAuthFixture>>;
let scenarioFile: string;
let log: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-opencode-auth-")));
  fixture = await openCodeAuthFixture();
  scenarioFile = join(root, "scenario.json");
  log = join(root, "cli.jsonl");
  await writeFile(scenarioFile, JSON.stringify({ serviceUrl: fixture.url }));
  vi.stubEnv("RELAY_ACP_SCENARIO_FILE", scenarioFile);
  vi.stubEnv("RELAY_ACP_LOG", log);
  const cli = await fakeCli(
    join(root, "opencode"),
    await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
    "opencode v2.0.32",
  );
  setLinkedAgents({ opencode: cli });
});

afterEach(async () => {
  await fixture.close();
  setLinkedAgents({});
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const start = () =>
  openCodeAuth({
    kind: "oauth",
    provider: "opencode",
    directory: root,
    method: "device",
    answer: { server: "https://example.invalid/console" },
  });

it("reads provider metadata without returning credentials and completes the browser flow through OpenCode", async () => {
  const before = await openCodeAuthProviders(root);
  expect(before[0]).toMatchObject({ id: "opencode", connected: false });
  const begun = await start();
  expect(begun.kind).toBe("attempt");
  if (begun.kind !== "attempt") throw new Error("No attempt");
  expect(
    await openCodeAuth({
      kind: "status",
      provider: "opencode",
      directory: root,
      attempt: begun.attempt.attemptID,
    }),
  ).toEqual({ kind: "status", state: { status: "pending" } });
  await fixture.complete();
  expect(
    await openCodeAuth({
      kind: "status",
      provider: "opencode",
      directory: root,
      attempt: begun.attempt.attemptID,
    }),
  ).toEqual({ kind: "status", state: { status: "complete" } });
  const after = await openCodeAuthProviders(root);
  expect(after[0].connected).toBe(true);
  expect(JSON.stringify(after)).not.toContain("must-not-reach-ui");
  expect(fixture.calls.every((call) => call.directory === root)).toBe(true);
});

it("sends API keys and pasted OAuth codes only in the HTTP body, and cancels only its own attempt", async () => {
  const one = await start();
  const two = await start();
  if (one.kind !== "attempt" || two.kind !== "attempt")
    throw new Error("No attempt");
  await openCodeAuth({
    kind: "cancel",
    provider: "opencode",
    attempt: one.attempt.attemptID,
  });
  expect(fixture.attempts.has(one.attempt.attemptID)).toBe(false);
  expect(fixture.attempts.has(two.attempt.attemptID)).toBe(true);
  await openCodeAuth({
    kind: "complete",
    provider: "opencode",
    attempt: two.attempt.attemptID,
    code: "fake-private-code",
  });
  await openCodeAuth({
    kind: "key",
    provider: "openrouter",
    key: "fake-private-key",
    answer: {},
  });
  expect(
    fixture.calls.some((call) => call.body?.key === "fake-private-key"),
  ).toBe(true);
  expect(
    fixture.calls.some((call) => call.body?.code === "fake-private-code"),
  ).toBe(true);
  const cli = await readFile(log, "utf8").catch(() => "");
  expect(cli).not.toContain("fake-private-key");
  expect(cli).not.toContain("fake-private-code");
});

it("recovers on the next call after a service password changes, without clearing provider credentials", async () => {
  expect((await openCodeAuthProviders())[0].id).toBe("opencode");
  fixture.controls.password = "replacement-password";
  await expect(openCodeAuthProviders()).rejects.toThrow("HTTP 401");
  await writeFile(
    scenarioFile,
    JSON.stringify({
      serviceUrl: fixture.url,
      servicePassword: fixture.controls.password,
    }),
  );
  expect((await openCodeAuthProviders())[0].id).toBe("opencode");
  expect(fixture.calls.filter((call) => call.method === "DELETE")).toHaveLength(
    0,
  );
});

it("doesn't leak an echoed secret, retry writes, or clear credentials on non-auth failures", async () => {
  for (const status of [403, 429, 503]) {
    fixture.controls.failure = status;
    fixture.controls.echo = "fake-private-key";
    const before = fixture.calls.length;
    const failed = await openCodeAuth({
      kind: "key",
      provider: "openrouter",
      key: "fake-private-key",
      answer: {},
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain(`HTTP ${status}`);
    expect((failed as Error).message).not.toContain("fake-private-key");
    expect(fixture.calls.length - before).toBe(1);
  }
  expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
});

it("refuses to send the local password or submitted key to a non-local service", async () => {
  await writeFile(
    scenarioFile,
    JSON.stringify({ serviceUrl: "http://example.invalid:1234" }),
  );
  await expect(
    openCodeAuth({
      kind: "key",
      provider: "opencode",
      key: "fake-private-key",
      answer: {},
    }),
  ).rejects.toThrow("local HTTP service");
  expect(fixture.calls).toHaveLength(0);
});
