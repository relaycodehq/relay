import { afterEach, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { updateKeys } from "../../shared/updates";

const run = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
let bundled: string;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const testKey = Buffer.from(
  publicKey.export({ format: "jwk" }).x!,
  "base64url",
).toString("base64");
async function signFeed(path: string) {
  await writeFile(
    `${path}.sig`,
    sign(null, await readFile(path), privateKey).toString("base64"),
  );
}
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
  await signFeed(feed);
  // Test fixtures get their own key without adding a production trust override.
  const installer = join(dir, "install.sh");
  const source = await readFile("packaging/headless/install.sh", "utf8");
  await writeFile(installer, source.replace(updateKeys[0]!, testKey));
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
  const result = await run("sh", [installer], {
    env,
  });
  expect(result.stdout).toContain("Relay 2.0.0 is installed");
  expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe("2.0.0");
  expect((await readFile(join(env.RELAY_HOME, "node"), "utf8")).trim()).toBe(
    process.execPath,
  );
  // A missing or invalid signature fails before unpacking or replacing anything.
  const signature = await readFile(`${feed}.sig`, "utf8");
  for (const value of [
    null,
    "invalid",
    sign(null, Buffer.from("different bytes"), privateKey).toString("base64"),
  ]) {
    if (value === null) await rm(`${feed}.sig`);
    else await writeFile(`${feed}.sig`, value);
    await expect(run("sh", [installer], { env })).rejects.toMatchObject({
      code: 1,
    });
    expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe(
      "2.0.0",
    );
  }
  await writeFile(`${feed}.sig`, signature);
  // Re-running the same installer remains a complete replacement, not .old nesting.
  await run("sh", [installer], { env });
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
  await signFeed(feed);
  await expect(run("sh", [installer], { env })).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("isn't a headless Relay"),
  });
  expect((await readFile(join(root, "VERSION"), "utf8")).trim()).toBe("2.0.0");
});

it("ships matching pinned-key verifiers in both self-contained installers", async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "relay-feed-verification-")),
  );
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const feed = join(dir, "latest.json");
  const signature = `${feed}.sig`;
  const other = generateKeyPairSync("ed25519");
  const scripts = await Promise.all([
    readFile("packaging/headless/install.sh", "utf8"),
    readFile("packaging/headless/install-relay.ps1", "utf8"),
  ]);
  const verifiers = scripts.map((source) =>
    source
      .match(
        /  const fs = require\("node:fs"\);[\s\S]*?if \(!valid\) throw new Error\([^\n]*\);/,
      )![0]
      .replace(/\r\n/g, "\n"),
  );
  expect(verifiers[0]).toBe(verifiers[1]);
  for (const verifier of verifiers) {
    expect(
      JSON.parse(verifier.match(/const keys = (\[[^;]+\]);/)![1]!),
    ).toEqual(updateKeys);
    const code = verifier.replace(updateKeys[0]!, testKey);
    const bytes = Buffer.from('{"version":"2.0.0"}\n');
    await writeFile(feed, bytes);
    await writeFile(
      signature,
      sign(null, bytes, privateKey).toString("base64"),
    );
    await run(process.execPath, ["-e", code, feed, signature]);
    // PowerShell pipes the verifier through stdin to avoid legacy argument quoting.
    const piped = run(process.execPath, ["-", feed, signature]);
    piped.child.stdin!.end(code);
    await piped;
    await writeFile(feed, Buffer.concat([bytes, Buffer.from(" ")]));
    await expect(
      run(process.execPath, ["-e", code, feed, signature]),
    ).rejects.toMatchObject({ code: 1 });
    await writeFile(feed, bytes);
    await writeFile(
      signature,
      sign(null, bytes, other.privateKey).toString("base64"),
    );
    await expect(
      run(process.execPath, ["-e", code, feed, signature]),
    ).rejects.toMatchObject({ code: 1 });
    // Key rotations may contain both obsolete and trusted signatures.
    await writeFile(
      signature,
      (await readFile(signature, "utf8")) +
        "\n" +
        sign(null, bytes, privateKey).toString("base64"),
    );
    await run(process.execPath, ["-e", code, feed, signature]);
  }
});
