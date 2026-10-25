import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshHosts } from "./ssh-hosts";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

it("lists the named hosts across includes, with where each goes", async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-ssh-"));
  await mkdir(join(dir, "conf.d"));
  await writeFile(
    join(dir, "config"),
    [
      "Include conf.d/*.conf",
      "# a comment",
      "Host thinkcenter box",
      "    HostName 192.168.0.141",
      "    User lubo",
      "    User ignored",
      "Host *.corp !bastion.corp",
      "    User me",
      "Host=quoted",
      '  HostName = "quoted.example"',
      "Match host thinkcenter",
      "    User someone-else",
      "Host *",
      "    ServerAliveInterval 30",
      "Include config", // a loop back to itself
    ].join("\n"),
  );
  await writeFile(
    join(dir, "conf.d", "work.conf"),
    "Host build\n  HostName build.internal\nHost thinkcenter\n  User other\n",
  );
  await writeFile(join(dir, "conf.d", "notes.txt"), "Host not-included\n");
  expect(await sshHosts(join(dir, "config"))).toEqual([
    { host: "build", hostName: "build.internal" },
    { host: "thinkcenter", user: "other" },
    { host: "box", hostName: "192.168.0.141", user: "lubo" },
    { host: "quoted", hostName: "quoted.example" },
  ]);
});

it("has none without a config", async () => {
  expect(await sshHosts(join(tmpdir(), "relay-no-such-ssh", "config"))).toEqual(
    [],
  );
});
