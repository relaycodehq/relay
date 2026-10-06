import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { folderVerdict, realFolder, type FolderRules } from "./project-folder";

const mac: FolderRules = {
  home: "/Users/ana",
  userData: "/Users/ana/Library/Application Support/Relay",
  temp: "/private/var/folders/xy/T",
  platform: "darwin",
  projects: [{ id: "relay", name: "relay", path: "/Users/ana/code/relay" }],
};
const verdict = (path: string, rules = mac) => folderVerdict(path, rules);
const refused = (path: string, rules = mac) => {
  const v = verdict(path, rules);
  return v.kind === "refused" ? v.reason : undefined;
};

test("the disk, home and what holds home are refused", () => {
  expect(refused("/")).toMatch(/whole disk/);
  expect(refused("/Users/ana")).toMatch(/home folder/);
  expect(refused("/Users")).toMatch(/holds the user's home/);
  // macOS ignores case, so a refusal must too.
  expect(refused("/users/ANA")).toMatch(/home folder/);
});

test("system folders are refused, inside and out", () => {
  for (const path of [
    "/System/Library",
    "/usr/local/lib",
    "/etc",
    "/private/etc/ssh",
    "/Applications/Relay.app",
    "/opt",
    "/Volumes",
    "/private/var",
    "/private/var/folders",
    "/private/var/folders/xy/T",
  ])
    expect(refused(path), path).toBeDefined();
  // A checkout under a shelf the system keeps is fine.
  expect(verdict("/private/var/folders/xy/T/scratch-repo")).toEqual({
    kind: "ok",
  });
  expect(verdict("/opt/src/tool")).toEqual({ kind: "ok" });
});

test("home's secrets are refused anywhere inside, its shelves only themselves", () => {
  expect(refused("/Users/ana/.ssh")).toBeDefined();
  expect(refused("/Users/ana/.aws/sso")).toBeDefined();
  expect(refused("/Users/ana/Library/Mobile Documents/x")).toBeDefined();
  expect(refused("/Users/ana/Documents")).toMatch(/holds too much/);
  expect(refused("/Users/ana/Downloads")).toMatch(/holds too much/);
  expect(verdict("/Users/ana/Documents/thesis")).toEqual({ kind: "ok" });
});

test("every dot-folder under home is refused, inside and out", () => {
  for (const path of [
    "/Users/ana/.config",
    "/Users/ana/.config/relay-android",
    "/Users/ana/.local/share/x",
    "/Users/ana/.docker",
    "/Users/ana/.cursor/projects",
  ])
    expect(refused(path), path).toMatch(/^Agents don't add anything in ~\/\./);
  expect(refused("/Users/ana/.config/gh")).toBe(
    "Agents don't add anything in ~/.config.",
  );
  // Only home's own: a dot-folder deeper down is a checkout's business.
  expect(verdict("/Users/ana/code/.dotfiles")).toEqual({ kind: "ok" });
});

test("mounted drives' roots and other users' homes are refused, what's inside them isn't", () => {
  for (const path of ["/Volumes/External", "/Users/bob", "/Users/Shared"])
    expect(refused(path), path).toBeDefined();
  expect(verdict("/Volumes/External/code/repo")).toEqual({ kind: "ok" });
  expect(verdict("/Users/bob/code")).toEqual({ kind: "ok" });
  const linux: FolderRules = {
    ...mac,
    home: "/home/ana",
    userData: "/home/ana/.config/Relay",
    temp: "/tmp",
    platform: "linux",
    projects: [],
  };
  for (const path of [
    "/media/ana",
    "/media/ana/USB",
    "/run/media/ana/USB",
    "/mnt/c",
    "/home/bob",
  ])
    expect(refused(path, linux), path).toBeDefined();
  expect(refused("/mnt/c", linux)).toMatch(/mounted drive/);
  for (const path of ["/media/ana/USB/repo", "/mnt/c/Users/ana/repo"])
    expect(verdict(path, linux), path).toEqual({ kind: "ok" });
});

test("Relay's own data and worktrees are refused", () => {
  expect(refused(`${mac.userData}/worktrees/relay/some-branch`)).toMatch(
    /Relay's own data/,
  );
  const linux: FolderRules = {
    ...mac,
    home: "/home/ana",
    userData: "/home/ana/.config/Relay",
    platform: "linux",
    projects: [],
  };
  expect(refused("/home/ana/.config/Relay/Scratchpad/a", linux)).toMatch(
    /Relay's own data/,
  );
  // Around it as well as in it, as with projects.
  const moved: FolderRules = { ...linux, userData: "/srv/relay/data/Relay" };
  expect(refused("/srv/relay", moved)).toBe(
    "That folder holds Relay's own data.",
  );
  expect(verdict("/srv/relay/code", moved)).toEqual({ kind: "ok" });
});

test("a project answers with its id; inside or around one is refused, naming it", () => {
  expect(verdict("/Users/ana/code/relay")).toEqual({
    kind: "existing",
    id: "relay",
  });
  expect(refused("/Users/ana/code/relay/server")).toMatch(
    /inside the project “relay” \(relay\)/,
  );
  expect(refused("/Users/ana/code")).toMatch(/holds the project “relay”/);
  expect(verdict("/Users/ana/code/relay-site")).toEqual({ kind: "ok" });
});

test("Linux minds case, and its system trees are its own", () => {
  const linux: FolderRules = {
    ...mac,
    home: "/home/ana",
    userData: "/home/ana/.config/Relay",
    temp: "/tmp",
    platform: "linux",
    projects: [{ id: "a", name: "a", path: "/home/ana/A" }],
  };
  expect(verdict("/home/ana/a", linux)).toEqual({ kind: "ok" });
  expect(refused("/var/lib/docker", linux)).toBe("That's a system folder.");
  expect(refused("/tmp", linux)).toBeDefined();
  expect(verdict("/tmp/checkout", linux)).toEqual({ kind: "ok" });
});

test("Windows refuses drive roots and its system trees, ignoring case", () => {
  const win: FolderRules = {
    home: "C:\\Users\\ana",
    userData: "C:\\Users\\ana\\AppData\\Roaming\\Relay",
    temp: "C:\\Users\\ana\\AppData\\Local\\Temp",
    platform: "win32",
    projects: [],
  };
  expect(refused("D:\\", win)).toMatch(/whole disk/);
  expect(refused("c:\\windows\\system32", win)).toBe("That's a system folder.");
  expect(refused("C:\\Program Files\\Git", win)).toBeDefined();
  expect(refused("C:\\Users\\ana\\AppData\\Local\\x", win)).toBeDefined();
  expect(refused("C:\\Users\\bob", win)).toBe(
    "That's another user's home folder.",
  );
  expect(refused("C:\\Users\\ana\\.ssh", win)).toBeDefined();
  expect(verdict("D:\\src\\relay", win)).toEqual({ kind: "ok" });
});

const made: string[] = [];
afterEach(async () => {
  for (const f of made.splice(0)) await rm(f, { recursive: true });
});

test("realFolder follows links and refuses files, missing and relative paths", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-folder-")));
  made.push(root);
  await mkdir(join(root, "repo"));
  await writeFile(join(root, "file.txt"), "");
  await symlink(join(root, "repo"), join(root, "link"));
  const platform = process.platform;
  expect(await realFolder(join(root, "link"), platform)).toEqual({
    real: join(root, "repo"),
  });
  expect(await realFolder(join(root, "file.txt"), platform)).toEqual({
    refused: `${join(root, "file.txt")} is a file, not a folder.`,
  });
  expect(await realFolder(join(root, "gone"), platform)).toEqual({
    refused: `There's no folder at ${join(root, "gone")}.`,
  });
  expect(await realFolder("repo", platform)).toEqual({
    refused: "Give the folder's absolute path.",
  });
});
