import "./build-rooms.mjs";
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const staging = await mkdtemp(join(tmpdir(), "relay-room-bundle-"));
const name = "ReviewRelay-RoomServer",
  folder = join(staging, name);
try {
  await mkdir(folder);
  await mkdir("release", { recursive: true });
  for (const [from, to] of [
    ["dist-server/server.mjs", "server.mjs"],
    ["server/README.md", "README.md"],
    ["scripts/install-rooms-macos.py", "install-rooms-macos.py"],
    ["LICENSE", "LICENSE"],
    ["node_modules/zod/LICENSE", "ZOD-LICENSE"],
  ])
    await copyFile(from, join(folder, to));
  const archive = resolve("release/ReviewRelay-RoomServer.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", staging, name]);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    archive + ".sha256",
    `${digest}  ReviewRelay-RoomServer.tar.gz\n`,
  );
  console.log(archive);
} finally {
  await rm(staging, { recursive: true, force: true });
}
