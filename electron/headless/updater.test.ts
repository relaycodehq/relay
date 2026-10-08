import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockPath } from "./lock";
import { HeadlessUpdater, installRoot } from "./updater";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "relay-headless-update-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x!;
  return { privateKey, key: Buffer.from(x, "base64url").toString("base64") };
}

/** An installed Relay of `version`, laid out as install.sh leaves it. */
function layout(root: string, version: string) {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "bin", "relay"), "#!/bin/sh\n");
  writeFileSync(join(root, "lib", "relay.cjs"), `// ${version}\n`);
  writeFileSync(join(root, "VERSION"), `${version}\n`);
}

/** A release of 2.0.0 served the way GitHub serves one, its feed signed by `by`. */
function release(by: ReturnType<typeof keyPair> | null) {
  const staging = join(dir, "staging");
  layout(join(staging, "relay-2.0.0"), "2.0.0");
  const archive = join(dir, "Relay-2.0.0-headless.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", staging, "relay-2.0.0"]);
  const bytes = readFileSync(archive);
  const feed = Buffer.from(
    JSON.stringify({
      version: "2.0.0",
      files: {},
      headless: {
        name: "Relay-2.0.0-headless.tar.gz",
        url: "https://example.test/Relay-2.0.0-headless.tar.gz",
        sha512: createHash("sha512").update(bytes).digest("base64"),
        size: bytes.length,
      },
    }),
  );
  const served: Record<string, Buffer | string> = {
    "https://example.test/latest.json": feed,
    "https://example.test/Relay-2.0.0-headless.tar.gz": bytes,
  };
  if (by)
    served["https://example.test/latest.json.sig"] = sign(
      null,
      feed,
      by.privateKey,
    ).toString("base64");
  const fetch = (async (url: string) => {
    const body = served[url];
    return body === undefined
      ? new Response("Not Found", { status: 404 })
      : new Response(new Uint8Array(Buffer.from(body)));
  }) as typeof globalThis.fetch;
  return { fetch, feed: "https://example.test/latest.json" };
}

function installed() {
  const root = join(dir, "relay");
  layout(root, "1.0.0");
  // installRoot is asked with the folder relay.cjs runs from.
  expect(installRoot(join(root, "lib"))).toBe(root);
  return root;
}

it("installs a release whose feed the pinned key signed", async () => {
  const key = keyPair();
  const root = installed();
  let restarted = false;
  const updater = new HeadlessUpdater(root, "1.0.0", {
    ...release(key),
    keys: [key.key],
    restart: () => (restarted = true),
  });
  expect(await updater.check()).toMatchObject({
    status: "available",
    version: "2.0.0",
  });
  await updater.install();
  expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe("2.0.0");
  expect(restarted).toBe(true);
});

it("refuses a feed nobody signed, or someone else did", async () => {
  const pinned = keyPair();
  for (const by of [null, keyPair()]) {
    const root = installed();
    const updater = new HeadlessUpdater(root, "1.0.0", {
      ...release(by),
      keys: [pinned.key],
    });
    expect(await updater.check()).toMatchObject({
      status: "error",
      message: expect.stringMatching(/won't install from it/),
    });
    expect((await updater.install()).status).toBe("error");
    expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe("1.0.0");
    rmSync(root, { recursive: true });
  }
});

it("joins concurrent check, download and install calls on one updater", async () => {
  const key = keyPair();
  const root = installed();
  const served = release(key);
  let downloads = 0,
    restarts = 0;
  const updater = new HeadlessUpdater(root, "1.0.0", {
    ...served,
    keys: [key.key],
    fetch: (async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).endsWith(".tar.gz")) downloads++;
      return served.fetch(...args);
    }) as typeof fetch,
    restart: () => {
      restarts++;
    },
  });
  const check = updater.check();
  const downloading = updater.download();
  const first = updater.install();
  const second = updater.install();
  expect(first).toBe(second);
  await Promise.all([check, downloading, first, second]);
  expect(downloads).toBe(1);
  expect(restarts).toBe(1);
  expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe("2.0.0");
});

it("independent updater staging survives another updater's install", async () => {
  const key = keyPair();
  const root = installed();
  const options = { ...release(key), keys: [key.key] };
  const first = new HeadlessUpdater(root, "1.0.0", options);
  let secondRestarted = false;
  const second = new HeadlessUpdater(root, "1.0.0", {
    ...options,
    restart: () => {
      secondRestarted = true;
    },
  });
  expect(
    (await Promise.all([first.download(), second.download()])).map(
      (s) => s.status,
    ),
  ).toEqual(["ready", "ready"]);
  expect((await first.install()).status).toBe("installing");
  // The second stage still exists and can validate that the version is installed.
  expect(await second.install()).toMatchObject({
    status: "idle",
    current: "2.0.0",
  });
  expect(secondRestarted).toBe(true);
  expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe("2.0.0");
});

it("refuses to swap while another process holds the installation lock", async () => {
  const key = keyPair();
  const root = installed();
  const updater = new HeadlessUpdater(root, "1.0.0", {
    ...release(key),
    keys: [key.key],
  });
  await updater.download();
  const unlock = await lockPath(`${root}.update`);
  try {
    expect(await updater.install()).toMatchObject({
      status: "error",
      message: expect.stringContaining("holds"),
    });
    expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe("1.0.0");
    expect(
      readdirSync(dir).filter((name) => name.startsWith("relay.update-")),
    ).toEqual([]);
  } finally {
    await unlock();
  }
});
