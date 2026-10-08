import { afterEach, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
let bundled: string;
beforeAll(async () => {
  const result = await build({
    entryPoints: ["electron/headless/install-command.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  bundled = result.outputFiles![0]!.text;
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

it("explains an invalid RELAY_NODE before downloading or changing anything", async () => {
  if (process.platform === "win32") return;
  await expect(
    run("sh", ["packaging/headless/install.sh"], {
      env: { ...process.env, RELAY_NODE: "/definitely/missing" },
    }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Node.js 22 or newer"),
  });
});

it("installs and replaces an archive end to end using the shared swap helper", async () => {
  if (process.platform === "win32") return;
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "relay-bootstrap-test-")),
  );
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const staged = join(dir, "relay-2.0.0"),
    root = join(dir, "installed");
  await mkdir(join(staged, "lib"), { recursive: true });
  await mkdir(join(staged, "bin"));
  await writeFile(join(staged, "lib", "install-files.cjs"), bundled);
  await writeFile(join(staged, "lib", "relay.cjs"), "// fixture");
  await writeFile(
    join(staged, "bin", "relay"),
    "#!/bin/sh\nprintf '{\"running\":false}\\n'\n",
    { mode: 0o755 },
  );
  await writeFile(join(staged, "VERSION"), "2.0.0");
  await mkdir(root);
  await writeFile(join(root, "VERSION"), "1.0.0");
  const archive = join(dir, "release.tar.gz");
  await run("tar", ["-czf", archive, "-C", dir, "relay-2.0.0"]);
  const feed = join(dir, "latest.json");
  const bytes = await readFile(archive);
  await writeFile(
    feed,
    JSON.stringify({
      version: "2.0.0",
      headless: {
        name: "release.tar.gz",
        url: pathToFileURL(archive).href,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      },
    }),
  );
  const env = {
    ...process.env,
    RELAY_NODE: process.execPath,
    RELAY_INSTALL: root,
    RELAY_BIN: join(dir, "bin"),
    RELAY_HOME: join(dir, "home"),
    RELAY_UPDATE_FEED: pathToFileURL(feed).href,
    RELAY_NO_SETUP: "1",
    RELAY_NO_MODIFY_PATH: "1",
  };
  const result = await run("sh", [resolve("packaging/headless/install.sh")], {
    env,
  });
  expect(result.stdout).toContain("Relay 2.0.0 is installed");
  expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe("2.0.0");
  expect((await readFile(join(env.RELAY_HOME, "node"), "utf8")).trim()).toBe(
    process.execPath,
  );
  // Re-running the same installer remains a complete replacement, not .old nesting.
  await run("sh", [resolve("packaging/headless/install.sh")], { env });
  expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe("2.0.0");
  // A malformed replacement must fail visibly and leave the working install.
  await writeFile(join(staged, "VERSION"), "unexpected-version");
  await run("tar", ["-czf", archive, "-C", dir, "relay-2.0.0"]);
  const malformed = await readFile(archive);
  await writeFile(
    feed,
    JSON.stringify({
      version: "2.0.0",
      headless: {
        name: "release.tar.gz",
        url: pathToFileURL(archive).href,
        sha512: createHash("sha512").update(malformed).digest("base64"),
      },
    }),
  );
  await expect(
    run("sh", [resolve("packaging/headless/install.sh")], { env }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("isn't a headless Relay"),
  });
  expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe("2.0.0");
});
