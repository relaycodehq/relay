import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpVersion, resolveVersion, syncVersion } from "./sync-version.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "relay-version-"));
  roots.push(root);
  mkdirSync(join(root, "mobile"));
  const write = (path, data) =>
    writeFileSync(join(root, path), JSON.stringify(data, null, 2) + "\n");
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  for (const prefix of ["", "mobile/"]) {
    write(`${prefix}package.json`, {
      name: "relay",
      version,
      dependencies: { example: "1.2.3" },
      scripts: {
        version: "node scripts/sync-version.mjs --package",
        "version:bump": "node scripts/sync-version.mjs --bump",
      },
    });
    write(`${prefix}package-lock.json`, {
      version,
      lockfileVersion: 3,
      packages: {
        "": { name: "relay", version, dependencies: { example: "1.2.3" } },
        "node_modules/example": { version: "1.2.3", integrity: "unchanged" },
      },
    });
  }
  write("mobile/app.json", { expo: { name: "Relay", version } });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    });
  const tag = (version) => {
    git("init", "--quiet");
    git(
      "-c",
      "user.name=Version test",
      "-c",
      "user.email=version@example.test",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Fixture",
    );
    git("tag", `v${version}`);
  };
  const versions = () => [
    read("package.json").version,
    read("package-lock.json").version,
    read("package-lock.json").packages[""].version,
    read("mobile/package.json").version,
    read("mobile/package-lock.json").version,
    read("mobile/package-lock.json").packages[""].version,
    read("mobile/app.json").expo.version,
  ];
  return { root, read, write, tag, git, versions };
}

describe("Relay version syncing", () => {
  it("syncs stale metadata from the reachable release tag without touching dependencies", () => {
    const f = fixture();
    f.tag("0.10.3");
    expect(syncVersion({ root: f.root })).toBe("0.10.3");
    expect(f.versions()).toEqual(Array(7).fill("0.10.3"));
    for (const prefix of ["", "mobile/"]) {
      expect(f.read(`${prefix}package.json`).dependencies).toEqual({
        example: "1.2.3",
      });
      expect(
        f.read(`${prefix}package-lock.json`).packages["node_modules/example"],
      ).toEqual({ version: "1.2.3", integrity: "unchanged" });
    }
  });

  it("keeps a package version ahead of the last release tag", () => {
    const f = fixture("0.11.0");
    f.tag("0.10.3");
    expect(syncVersion({ root: f.root })).toBe("0.11.0");
    expect(f.versions()).toEqual(Array(7).fill("0.11.0"));
  });

  it("uses package.json in a source archive without Git", () => {
    const f = fixture("0.10.3");
    expect(resolveVersion({ root: f.root })).toBe("0.10.3");
  });

  it("doesn't take a release tag from another branch", () => {
    const f = fixture();
    f.tag("0.10.3");
    const commit = f.git("rev-parse", "HEAD").toString().trim();
    f.git("checkout", "--quiet", "-b", "other");
    f.git(
      "-c",
      "user.name=Version test",
      "-c",
      "user.email=version@example.test",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Unrelated",
    );
    f.git("tag", "v9.0.0");
    f.git("checkout", "--quiet", "--detach", commit);
    expect(resolveVersion({ root: f.root })).toBe("0.10.3");
  });

  it("uses an explicit release version even when the package and tags differ", () => {
    const f = fixture("0.11.0");
    f.tag("0.10.3");
    expect(syncVersion({ root: f.root, version: "v0.9.0" })).toBe("0.9.0");
    expect(f.versions()).toEqual(Array(7).fill("0.9.0"));
  });

  it.each(["", "vnext", "0.10", "0.10.3-beta", "00.10.3"])(
    "refuses invalid version %j before changing metadata",
    (version) => {
      const f = fixture();
      expect(() => syncVersion({ root: f.root, version })).toThrow(
        "Not a release version",
      );
      expect(f.versions()).toEqual(Array(7).fill("0.1.0"));
    },
  );

  it("reads all metadata before writing any of it", () => {
    const f = fixture();
    writeFileSync(join(f.root, "mobile/app.json"), "broken JSON");
    expect(() => syncVersion({ root: f.root, version: "0.10.3" })).toThrow();
    expect(f.read("package.json").version).toBe("0.1.0");
    expect(f.read("mobile/package-lock.json").version).toBe("0.1.0");
  });

  it("leaves already synced files untouched", () => {
    const f = fixture();
    syncVersion({ root: f.root, version: "0.10.3" });
    const path = join(f.root, "mobile/app.json");
    const before = statSync(path).mtimeMs;
    syncVersion({ root: f.root, version: "0.10.3" });
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it("syncs the phone and both lockfiles through npm version's lifecycle", () => {
    const f = fixture();
    mkdirSync(join(f.root, "scripts"));
    copyFileSync(
      new URL("./sync-version.mjs", import.meta.url),
      join(f.root, "scripts/sync-version.mjs"),
    );
    execFileSync(
      "npm",
      ["version", "0.10.4", "--no-git-tag-version", "--ignore-scripts=false"],
      {
        cwd: f.root,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      },
    );
    expect(f.versions()).toEqual(Array(7).fill("0.10.4"));
  });
});

describe("Relay version bumps", () => {
  it.each([
    ["patch", "0.10.4"],
    ["minor", "0.11.0"],
    ["major", "1.0.0"],
    ["0.12.7", "0.12.7"],
    ["v0.12.7", "0.12.7"],
  ])("bumps %s and syncs every version to %s", (bump, version) => {
    const f = fixture("0.10.3");
    expect(bumpVersion({ root: f.root, bump })).toBe(version);
    expect(f.versions()).toEqual(Array(7).fill(version));
    expect(
      f.read("package-lock.json").packages["node_modules/example"],
    ).toEqual({ version: "1.2.3", integrity: "unchanged" });
  });

  it("defaults to a patch bump from the newer reachable tag", () => {
    const f = fixture();
    f.tag("0.10.3");
    expect(bumpVersion({ root: f.root })).toBe("0.10.4");
    expect(f.versions()).toEqual(Array(7).fill("0.10.4"));
  });

  it.each(["0.10.3", "0.9.9", "nope", "0.11.0-beta"])(
    "refuses bump %j without changing metadata",
    (bump) => {
      const f = fixture("0.10.3");
      expect(() => bumpVersion({ root: f.root, bump })).toThrow();
      expect(f.versions()).toEqual(Array(7).fill("0.10.3"));
    },
  );

  it.each([[], ["minor"], ["0.12.7"]])(
    "runs the npm bump command with lifecycle hooks disabled: %j",
    (...args) => {
      const f = fixture("0.10.3");
      mkdirSync(join(f.root, "scripts"));
      copyFileSync(
        new URL("./sync-version.mjs", import.meta.url),
        join(f.root, "scripts/sync-version.mjs"),
      );
      // A hook would fail if npm tried to use it. The bump must run directly.
      const pkg = f.read("package.json");
      pkg.scripts.version = 'node -e "process.exit(1)"';
      pkg.scripts["version:bump"] = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).scripts["version:bump"];
      f.write("package.json", pkg);
      const result = execFileSync(
        "npm",
        ["run", "version:bump", "--ignore-scripts=true", "--", ...args],
        {
          cwd: f.root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        },
      );
      const version = args[0] === "minor" ? "0.11.0" : (args[0] ?? "0.10.4");
      expect(f.versions()).toEqual(Array(7).fill(version));
      expect(result).toContain(`Relay ${version}`);
    },
  );
});
