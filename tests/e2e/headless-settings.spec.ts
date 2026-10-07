import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { fixtureServer } from "../fixtures/gitea";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("relay settings changes a headless Relay and signs it in to Cursor and Gitea from the terminal", async () => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, ["scripts/build-headless.mjs", "9.9.9"]);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-headless-settings-")),
    ),
    home = join(root, "home"),
    bin = join(root, "bin"),
    done = join(root, "signed-in");
  // Cursor's SDK as Relay downloads it, the fixture's stand-in.
  const pkg = join(home, "cursor-sdk/1.0.32/node_modules/@cursor/sdk");
  await mkdir(join(pkg, "dist/esm"), { recursive: true });
  await copyFile(
    resolve("tests/fixtures/cursor-sdk.mjs"),
    join(pkg, "dist/esm/index.js"),
  );
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@cursor/sdk", version: "1.0.32", type: "module" }),
  );
  await writeFile(
    join(home, "cursor-sdk/current.json"),
    JSON.stringify({ version: "1.0.32" }),
  );
  await mkdir(bin);
  const codex = await fakeCli(
    join(bin, "codex-elsewhere"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    "7.7.7",
  );
  const gitea = await fixtureServer();
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  const env = {
    ...base,
    ...pathWith(base, bin),
    RELAY_HOME: home,
    RELAY_TEST_DATA: home,
    RELAY_REMOTE_TAILNET: "127.0.0.1",
    CURSOR_FAKE_LOGIN_DONE: done,
  };
  const relay = (...args: string[]) =>
    execFileSync(process.execPath, ["dist-headless/relay.cjs", ...args], {
      encoding: "utf8",
      env,
    });
  const settings = async () =>
    JSON.parse(
      await new Promise<string>((resolve) => {
        const child = spawn(
          process.execPath,
          ["dist-headless/relay.cjs", "settings", "--json"],
          { env },
        );
        let said = "";
        child.stdout.on("data", (chunk) => (said += chunk));
        child.once("exit", () => resolve(said));
      }),
    );
  try {
    relay("start", "--port", String(await freePort()));

    relay("settings", "set", "keep-awake", "off");
    relay("settings", "set", "auto-settle", "never");
    relay("settings", "set", "new-thread-agent", "claude");
    relay("settings", "set", "codex", codex);
    relay("settings", "set", "name", "Mini");
    expect(() => relay("settings", "set", "auto-settle", "400")).toThrow(
      /from 1 to 90/,
    );
    const changed = await settings();
    expect(changed).toMatchObject({
      keepAwake: false,
      autoSettleDays: null,
      newThreadAgent: "claude",
      // Saved now, used from the next start.
      name: "Mini",
    });
    expect(
      changed.agents.find((a: { provider: string }) => a.provider === "codex"),
    ).toMatchObject({
      path: codex,
      linked: true,
      current: "7.7.7",
    });

    // Cursor gives a page to open elsewhere; the terminal waits for it.
    const signIn = spawn(
      process.execPath,
      ["dist-headless/relay.cjs", "settings", "cursor", "sign-in"],
      { env },
    );
    let output = "";
    signIn.stdout.on("data", (chunk) => (output += chunk));
    signIn.stderr.on("data", (chunk) => (output += chunk));
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toContain("https://cursor.com/loginDeepControl?challenge=fake");
    await writeFile(done, "");
    const code = await new Promise((r) => signIn.once("exit", r));
    expect(output).toContain("Signed in to Cursor.");
    expect(code).toBe(0);

    // A Gitea token comes on stdin, out of the shell's history. Not with
    // execFileSync: the fake Gitea answers from this process.
    const signedIn = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "dist-headless/relay.cjs",
          "settings",
          "gitea",
          "sign-in",
          gitea.serverUrl,
        ],
        { env },
      );
      let said = "";
      child.stdout.on("data", (chunk) => (said += chunk));
      child.stderr.on("data", (chunk) => (said += chunk));
      child.once("exit", (exit) =>
        exit === 0 ? resolve(said) : reject(new Error(said)),
      );
      child.stdin.end("test-token\n");
    });
    expect(signedIn).toMatch(/Signed in to .* as /);
    expect((await settings()).gitea.server).toBe(gitea.serverUrl);
    await new Promise((r) =>
      spawn(
        process.execPath,
        ["dist-headless/relay.cjs", "settings", "gitea", "sign-out"],
        { env },
      ).once("exit", r),
    );
    expect((await settings()).gitea).toBeNull();

    // The name is put to use by a restart.
    relay("restart");
    expect(JSON.parse(relay("status", "--json")).status.name).toBe("Mini");
    relay("stop", "--force");
  } finally {
    try {
      relay("stop", "--force");
    } catch {
      // Already stopped.
    }
    gitea.server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
