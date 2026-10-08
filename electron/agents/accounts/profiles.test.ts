import { afterEach, beforeEach, expect, it } from "vitest";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountEnv,
  prepareProfile,
  profileDir,
  removeProfile,
  setProfilesRoot,
} from "./profiles";

let dir: string, home: string;
const saved = { ...process.env };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-accounts-"));
  home = join(dir, "claude-home");
  await mkdir(join(home, "projects", "-repo"), { recursive: true });
  await writeFile(join(home, "projects", "-repo", "s.jsonl"), "conversation");
  await writeFile(join(home, "settings.json"), "{}");
  await writeFile(join(home, "CLAUDE.md"), "be nice");
  await writeFile(join(home, ".credentials.json"), "secret");
  process.env.CLAUDE_CONFIG_DIR = home;
  process.env.ANTHROPIC_API_KEY = "sk-relay";
  setProfilesRoot(join(dir, "profiles"));
});
afterEach(async () => {
  process.env = { ...saved };
  await rm(dir, { recursive: true, force: true });
});

it("links the usual home into a profile, but never its sign-in", async () => {
  const profile = await prepareProfile("claude", "work");
  expect((await readdir(profile)).sort()).toEqual([
    "CLAUDE.md",
    "projects",
    "settings.json",
  ]);
  expect((await lstat(join(profile, "projects"))).isSymbolicLink()).toBe(true);
  expect(
    await readFile(join(profile, "projects", "-repo", "s.jsonl"), "utf8"),
  ).toBe("conversation");
});

it("links what the usual home gained since, and keeps what the profile made its own", async () => {
  const profile = await prepareProfile("claude", "work");
  await rm(join(profile, "settings.json"));
  await writeFile(join(profile, "settings.json"), '{ "mine": true }');
  await mkdir(join(home, "skills"));
  await prepareProfile("claude", "work");
  expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(profile, "settings.json"), "utf8")).toContain(
    "mine",
  );
});

it("removes a profile's links without touching what they point at", async () => {
  await prepareProfile("claude", "work");
  await removeProfile("claude", "work");
  await expect(lstat(profileDir("claude", "work"))).rejects.toThrow();
  expect(
    await readFile(join(home, "projects", "-repo", "s.jsonl"), "utf8"),
  ).toBe("conversation");
  expect(await readFile(join(home, "CLAUDE.md"), "utf8")).toBe("be nice");
});

it("points the CLI at the profile and drops credentials it would prefer", () => {
  const env = accountEnv("claude", "work");
  expect(env.CLAUDE_CONFIG_DIR).toBe(profileDir("claude", "work"));
  expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(
    profileDir("claude", "work"),
  );
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  // The usual sign-in runs on Relay's environment as it is.
  expect(accountEnv("claude", "default").ANTHROPIC_API_KEY).toBe("sk-relay");
  expect(accountEnv("codex", "work").CODEX_HOME).toBe(
    profileDir("codex", "work"),
  );
});

it("refuses folder names that aren't account ids", () => {
  expect(() => profileDir("claude", "../../x")).toThrow();
  expect(() => profileDir("claude", "default")).toThrow();
});
