import { expect, it } from "vitest";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { controlSocket, prepareControlSocket, relayHome } from "./paths";

it("keeps everything in ~/.relay unless told otherwise", () => {
  expect(relayHome({})).toBe(join(homedir(), ".relay"));
  expect(relayHome({ RELAY_HOME: "/srv/relay" })).toBe(resolve("/srv/relay"));
});

it("puts the control socket in the home folder while its path fits", () => {
  expect(controlSocket("/home/me/.relay", "linux")).toBe(
    "/home/me/.relay/relay.sock",
  );
  const deep = "/home/me/" + "nested/".repeat(20) + ".relay";
  expect(controlSocket(deep, "linux")).toMatch(
    /^\/tmp\/relay-[0-9a-f-]{36}\/control\.sock$/,
  );
  expect(controlSocket("C:\\Users\\me\\.relay", "win32")).toMatch(
    /^\\\\\.\\pipe\\relay-[0-9a-f]{16}$/,
  );
});

it("publishes a random private endpoint for long homes and recovers after temporary-directory cleanup", async () => {
  if (process.platform === "win32") return;
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-long-home-")),
  );
  const home = join(root, "nested".repeat(20));
  await mkdir(home, { mode: 0o700 });
  const directories = new Set<string>();
  try {
    expect(controlSocket(home)).not.toBe(controlSocket(home));
    const first = await prepareControlSocket(home);
    directories.add(dirname(first));
    expect(Buffer.byteLength(first)).toBeLessThan(100);
    expect(controlSocket(home)).toBe(first);
    expect(await prepareControlSocket(home)).toBe(first);
    expect((await stat(dirname(first))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "control-path"))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(home, "control-path"), "utf8")).trim()).toBe(
      first,
    );
    await rm(dirname(first), { recursive: true });
    expect(controlSocket(home)).not.toBe(first);
    const second = await prepareControlSocket(home);
    directories.add(dirname(second));
    expect(second).not.toBe(first);
    expect(controlSocket(home)).toBe(second);
    // Reject an accessible replacement, keeping any foreign contents intact.
    await chmod(dirname(second), 0o777);
    await writeFile(join(dirname(second), "foreign"), "preserve");
    expect(controlSocket(home)).not.toBe(second);
    const third = await prepareControlSocket(home);
    directories.add(dirname(third));
    expect(third).not.toBe(second);
    expect(await readFile(join(dirname(second), "foreign"), "utf8")).toBe(
      "preserve",
    );
    // A symlink to an otherwise private directory is not a trusted endpoint.
    await rm(dirname(third), { recursive: true });
    await chmod(dirname(second), 0o700);
    await symlink(dirname(second), dirname(third));
    expect(controlSocket(home)).not.toBe(third);
    const fourth = await prepareControlSocket(home);
    directories.add(dirname(fourth));
    expect(controlSocket(home)).toBe(fourth);
  } finally {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
