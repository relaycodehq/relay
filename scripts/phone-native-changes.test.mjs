import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lastReleaseTag, nativeChangesSince } from "./phone-native-changes.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function released() {
  const root = mkdtempSync(join(tmpdir(), "relay-native-changes-"));
  roots.push(root);
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.test",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.test",
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env, stdio: "ignore" });
  const write = (path, data) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
    );
  };
  const stamp = (version, deps = { expo: "57.0.25" }) => {
    write("mobile/package.json", { name: "relay-remote", version, dependencies: deps });
    write("mobile/package-lock.json", {
      name: "relay-remote",
      version,
      packages: { "": { version, dependencies: deps } },
    });
    write("mobile/app.json", { expo: { name: "Relay", version } });
  };
  git("init", "-q");
  stamp("0.11.1");
  write("mobile/modules/relay-apk/android/src/Apk.kt", "class Apk\n");
  write("mobile/src/App.tsx", "export {};\n");
  git("add", "-A");
  git("commit", "-qm", "release");
  git("tag", "-a", "v0.11.1", "-m", "v0.11.1");
  return { root, git, write, stamp, changes: () => nativeChangesSince(lastReleaseTag(root), root) };
}

it("lets version bumps and app code through", () => {
  const repo = released();
  repo.stamp("0.11.2");
  repo.write("mobile/src/App.tsx", "export const speed = 1;\n");
  repo.write("mobile/modules/relay-mic/ios/Mic.swift", "class Mic {}\n");
  expect(repo.changes()).toEqual([]);
});

it("catches native code, plugins and dependencies, committed or not", () => {
  const repo = released();
  repo.write("mobile/modules/relay-apk/android/src/Apk.kt", "class Apk2\n");
  repo.git("commit", "-qam", "native");
  repo.write("mobile/plugins/new-plugin.js", "module.exports = (c) => c;\n");
  repo.stamp("0.11.2", { expo: "57.0.26" });
  expect(repo.changes()).toEqual([
    "mobile/modules/relay-apk/android/src/Apk.kt",
    "mobile/package-lock.json",
    "mobile/package.json",
    "mobile/plugins/new-plugin.js",
  ]);
});
