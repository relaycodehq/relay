import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./tag-release.sh", import.meta.url));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(version = "0.11.0", landed = true) {
  const root = mkdtempSync(join(tmpdir(), "relay-tag-release-"));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.test",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.test",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const pkg = (version) =>
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ version }) + "\n",
    );
  git("init", "--quiet", "--bare", remote);
  git("init", "--quiet", "--initial-branch=main");
  pkg("0.10.3");
  git("add", "package.json");
  git("commit", "--quiet", "-m", "Previous release");
  git("tag", "-a", "v0.10.3", "-m", "Previous release notes");
  pkg(version);
  if (landed) {
    git("add", "package.json");
    git("commit", "--quiet", "--allow-empty", "-m", "Next release");
  }
  git("remote", "add", "origin", remote);
  git("push", "--quiet", "origin", "main", "--tags");
  const notes = join(root, "release notes.md");
  const changelog = "# Changes\n\nA useful fix.\n";
  writeFileSync(notes, changelog);
  const release = (...args) =>
    execFileSync("bash", [script, ...args], {
      cwd: repo,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const remoteTags = () => git("--git-dir", remote, "tag", "-l").split("\n");
  return { git, pkg, notes, changelog, release, remoteTags };
}

// The release script runs on the Mac mini and requires a Unix shell.
describe.skipIf(process.platform === "win32")("tagging a release", () => {
  it("defaults to the bumped package version and pushes an annotated tag on origin/main", () => {
    const f = fixture();
    const result = f.release(f.notes);
    expect(result).toContain("Tagged v0.11.0");
    expect(f.git("cat-file", "-t", "refs/tags/v0.11.0")).toBe("tag");
    expect(f.git("rev-parse", "v0.11.0^{commit}")).toBe(
      f.git("rev-parse", "origin/main"),
    );
    expect(f.git("tag", "-l", "--format=%(contents)", "v0.11.0")).toBe(
      f.changelog.trim(),
    );
    expect(f.remoteTags()).toEqual(["v0.10.3", "v0.11.0"]);
  });

  it("lets an explicit version override the package, without needing to read it", () => {
    const f = fixture();
    f.pkg("not-a-version");
    expect(f.release(f.notes, "0.12.0")).toContain("Tagged v0.12.0");
    expect(f.remoteTags()).toEqual(["v0.10.3", "v0.12.0"]);
  });

  it.each(["0.10.3", "0.9.9", "not-a-version"])(
    "refuses package version %s without tagging",
    (version) => {
      const f = fixture(version);
      expect(() => f.release(f.notes)).toThrow();
      expect(f.remoteTags()).toEqual(["v0.10.3"]);
      expect(f.git("tag", "-l")).toBe("v0.10.3");
    },
  );

  it.each(["0.10.3", "0.9.9", "not-a-version"])(
    "still refuses invalid explicit version %s",
    (version) => {
      const f = fixture();
      expect(() => f.release(f.notes, version)).toThrow();
      expect(f.remoteTags()).toEqual(["v0.10.3"]);
    },
  );

  it("still requires new commits on origin/main", () => {
    const f = fixture("0.11.0", false);
    expect(() => f.release(f.notes)).toThrow(
      "Nothing on origin/main since v0.10.3",
    );
    expect(f.remoteTags()).toEqual(["v0.10.3"]);
  });

  it("keeps log mode independent of the package version", () => {
    const f = fixture();
    f.pkg("not-a-version");
    expect(f.release("log")).toContain("Next release");
    expect(f.remoteTags()).toEqual(["v0.10.3"]);
  });
});
