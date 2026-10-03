import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installedSdk,
  installSdk,
  latestSdkVersion,
  NeedsRelayUpdate,
  sdkLock,
  type SdkLock,
} from "./sdk-install";

const registry = "https://registry.npmjs.org/";

interface Entry {
  name: string;
  body?: string;
  mode?: number;
  type?: string;
}

/** An npm tarball: everything under `package/`, gzipped. */
function tarball(entries: Entry[]) {
  const blocks: Buffer[] = [];
  for (const { name, body = "", mode = 0o644, type = "0" } of entries) {
    const header = Buffer.alloc(512);
    header.write(name);
    header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
    header.write(
      Buffer.byteLength(body).toString(8).padStart(11, "0") + "\0",
      124,
    );
    header.write(type, 156);
    blocks.push(header, Buffer.from(body));
    const pad = (512 - (Buffer.byteLength(body) % 512)) % 512;
    blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const integrity = (data: Buffer) =>
  "sha512-" + createHash("sha512").update(data).digest("base64");

function sdkPackage(version: string, extra: Entry[] = []) {
  return tarball([
    {
      name: "package/package.json",
      body: JSON.stringify({ name: "@cursor/sdk", version }),
    },
    {
      name: "package/dist/esm/index.js",
      body: `export const version = "${version}";`,
    },
    ...extra,
  ]);
}
const platformPackage = (version: string) =>
  tarball([
    { name: "package/package.json", body: `{"version":"${version}"}` },
    { name: "package/bin/rg", body: "#!/bin/sh\n", mode: 0o755 },
    { name: "package/bin/notes.txt", body: "plain" },
  ]);
const dependency = tarball([
  { name: "package/package.json", body: '{"version":"1.10.0"}' },
  { name: "package/index.js", body: "module.exports = 1" },
]);

/** The registry as the installer sees it: tarballs by URL, manifests and the packument. */
function fakeRegistry(files: Record<string, Buffer | object>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const found = files[url];
    if (!found) return new Response("no", { status: 404 });
    return Buffer.isBuffer(found)
      ? new Response(new Uint8Array(found))
      : Response.json(found);
  };
  return { fetch, asked };
}

const lockFor = (
  version: string,
  sdk: Buffer,
  platform: Buffer,
  dep: Buffer,
): SdkLock => ({
  sdk: version,
  dependencies: { "@bufbuild/protobuf": "1.10.0" },
  packages: {
    "node_modules/@cursor/sdk": {
      version,
      resolved: `${registry}@cursor/sdk/-/sdk-${version}.tgz`,
      integrity: integrity(sdk),
    },
    "node_modules/@cursor/sdk-darwin-arm64": {
      version,
      resolved: `${registry}@cursor/sdk-darwin-arm64/-/sdk-darwin-arm64-${version}.tgz`,
      integrity: integrity(platform),
      os: ["darwin"],
      cpu: ["arm64"],
    },
    "node_modules/@cursor/sdk-linux-x64": {
      version,
      resolved: `${registry}@cursor/sdk-linux-x64/-/sdk-linux-x64-${version}.tgz`,
      integrity: integrity(platform),
      os: ["linux"],
      cpu: ["x64"],
    },
    "node_modules/@bufbuild/protobuf": {
      version: "1.10.0",
      resolved: `${registry}@bufbuild/protobuf/-/protobuf-1.10.0.tgz`,
      integrity: integrity(dep),
    },
  },
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-cursor-sdk-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const mac = { platform: "darwin", arch: "arm64" };

describe("installing the Cursor SDK", () => {
  const sdk = sdkPackage("1.0.32");
  const platform = platformPackage("1.0.32");
  const lock = lockFor("1.0.32", sdk, platform, dependency);
  const files = {
    [lock.packages["node_modules/@cursor/sdk"].resolved]: sdk,
    [lock.packages["node_modules/@cursor/sdk-darwin-arm64"].resolved]: platform,
    [lock.packages["node_modules/@bufbuild/protobuf"].resolved]: dependency,
  };

  it("downloads only this machine's platform package and keeps binaries executable", async () => {
    const { fetch, asked } = fakeRegistry(files);
    const installed = await installSdk(root, fetch, { ...mac, lock });

    expect(installed.version).toBe("1.0.32");
    expect(await readFile(installed.entry, "utf8")).toContain("1.0.32");
    expect(asked.some((url) => url.includes("linux-x64"))).toBe(false);
    const rg = join(
      installed.dir,
      "node_modules/@cursor/sdk-darwin-arm64/bin/rg",
    );
    expect((await stat(rg)).mode & 0o111).not.toBe(0);
    const notes = join(
      installed.dir,
      "node_modules/@cursor/sdk-darwin-arm64/bin/notes.txt",
    );
    expect((await stat(notes)).mode & 0o111).toBe(0);
    expect(await installedSdk(root)).toEqual(installed);
  });

  it("refuses a download that doesn't match its hash and leaves nothing behind", async () => {
    const { fetch } = fakeRegistry({
      ...files,
      [lock.packages["node_modules/@bufbuild/protobuf"].resolved]: tarball([
        { name: "package/package.json", body: "tampered" },
      ]),
    });
    await expect(installSdk(root, fetch, { ...mac, lock })).rejects.toThrow(
      /hash/,
    );
    expect(await installedSdk(root)).toBeUndefined();
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses files that would land outside the package, and links", async () => {
    for (const bad of [
      { name: "package/../../escape.js", body: "x" },
      { name: "package/link", type: "2" },
    ]) {
      const evil = sdkPackage("1.0.32", [bad]);
      const badLock = lockFor("1.0.32", evil, platform, dependency);
      const { fetch } = fakeRegistry({
        [badLock.packages["node_modules/@cursor/sdk"].resolved]: evil,
        [badLock.packages["node_modules/@cursor/sdk-darwin-arm64"].resolved]:
          platform,
        [badLock.packages["node_modules/@bufbuild/protobuf"].resolved]:
          dependency,
      });
      await expect(
        installSdk(root, fetch, { ...mac, lock: badLock }),
      ).rejects.toThrow(/unsafe|link/);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it("doesn't download from anywhere but npm", async () => {
    const elsewhere: SdkLock = {
      ...lock,
      packages: {
        ...lock.packages,
        "node_modules/@bufbuild/protobuf": {
          ...lock.packages["node_modules/@bufbuild/protobuf"],
          resolved: "https://example.com/protobuf.tgz",
        },
      },
    };
    const { fetch, asked } = fakeRegistry(files);
    await expect(
      installSdk(root, fetch, { ...mac, lock: elsewhere }),
    ).rejects.toThrow(/Refusing/);
    expect(asked.some((url) => url.includes("example.com"))).toBe(false);
  });

  it("says so when the SDK has no build for this machine", async () => {
    const { fetch } = fakeRegistry(files);
    await expect(
      installSdk(root, fetch, { platform: "freebsd", arch: "x64", lock }),
    ).rejects.toThrow(/no build for freebsd x64/);
  });

  describe("updating", () => {
    const newer = sdkPackage("1.0.33");
    const newerPlatform = platformPackage("1.0.33");
    const manifest = (
      name: string,
      version: string,
      data: Buffer,
      deps?: object,
    ) => ({
      version,
      dependencies: deps,
      dist: {
        tarball: `${registry}${name}/-/${name.split("/")[1]}-${version}.tgz`,
        integrity: integrity(data),
      },
    });
    const update = (deps: object = lock.dependencies) => ({
      ...files,
      [`${registry}@cursor%2Fsdk/1.0.33`]: manifest(
        "@cursor/sdk",
        "1.0.33",
        newer,
        deps,
      ),
      [`${registry}@cursor%2Fsdk-darwin-arm64/1.0.33`]: manifest(
        "@cursor/sdk-darwin-arm64",
        "1.0.33",
        newerPlatform,
      ),
      [`${registry}@cursor/sdk/-/sdk-1.0.33.tgz`]: newer,
      [`${registry}@cursor/sdk-darwin-arm64/-/sdk-darwin-arm64-1.0.33.tgz`]:
        newerPlatform,
    });

    it("installs a newer SDK that asks for the same dependencies, keeping the one before", async () => {
      await installSdk(root, fakeRegistry(files).fetch, { ...mac, lock });
      const updated = await installSdk(root, fakeRegistry(update()).fetch, {
        ...mac,
        lock,
        version: "1.0.33",
      });
      expect(await readFile(updated.entry, "utf8")).toContain("1.0.33");
      expect((await installedSdk(root))?.version).toBe("1.0.33");
      await access(join(root, "1.0.32"));
    });

    it("leaves the working SDK alone when the newer one wants other dependencies", async () => {
      await installSdk(root, fakeRegistry(files).fetch, { ...mac, lock });
      await expect(
        installSdk(
          root,
          fakeRegistry(update({ "@bufbuild/protobuf": "2.0.0" })).fetch,
          { ...mac, lock, version: "1.0.33" },
        ),
      ).rejects.toBeInstanceOf(NeedsRelayUpdate);
      expect((await installedSdk(root))?.version).toBe("1.0.32");
    });
  });
});

describe("the newest SDK Relay offers", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const packument = {
    versions: { "1.0.31": {}, "1.0.32": {}, "1.0.33": {}, "1.1.0-beta.1": {} },
    time: {
      "1.0.31": "2026-09-01T00:00:00Z",
      "1.0.32": "2026-09-22T00:00:00Z",
      "1.0.33": "2026-09-28T00:00:00Z",
      "1.1.0-beta.1": "2026-09-01T00:00:00Z",
    },
  };

  it("waits three days for a release and skips prereleases", async () => {
    const { fetch } = fakeRegistry({ [`${registry}@cursor%2Fsdk`]: packument });
    expect(await latestSdkVersion(fetch, now)).toBe("1.0.32");
  });
});

describe("the pinned SDK", () => {
  it("matches what package-lock.json installs, so a bump can't leave the pin behind", async () => {
    const { packages } = JSON.parse(
      await readFile("package-lock.json", "utf8"),
    );
    expect(packages["node_modules/@cursor/sdk"].version).toBe(sdkLock.sdk);
    expect(packages["node_modules/@cursor/sdk"].dependencies).toEqual(
      sdkLock.dependencies,
    );
    for (const [path, pinned] of Object.entries(sdkLock.packages))
      expect(packages[path]?.integrity, path).toBe(pinned.integrity);
  });
});
