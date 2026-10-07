// Packs the headless Relay into release/Relay-<version>-headless.tar.gz, one
// archive for every platform since nothing in it is native, and copies the
// installers beside it: release/install-relay.sh and, for Windows,
// release/install-relay.ps1.
//
//   node scripts/package-headless.mjs [version]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildHeadless, headlessOut } from "./build-headless.mjs";

const version = await buildHeadless(process.argv[2]);
const staging = mkdtempSync(join(tmpdir(), "relay-headless-"));
const name = `relay-${version}`,
  folder = join(staging, name);
try {
  mkdirSync(join(folder, "bin"), { recursive: true });
  copyFileSync("packaging/headless/relay", join(folder, "bin", "relay"));
  chmodSync(join(folder, "bin", "relay"), 0o755);
  copyFileSync(
    "packaging/headless/relay.cmd",
    join(folder, "bin", "relay.cmd"),
  );
  cpSync(headlessOut, join(folder, "lib"), { recursive: true });
  // The phone app's code, which paired phones update from; see remote/phone-app.
  if (existsSync("dist-phone"))
    cpSync("dist-phone", join(folder, "dist-phone"), { recursive: true });
  copyFileSync("docs/headless.md", join(folder, "README.md"));
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
    copyFileSync(file, join(folder, file));
  writeFileSync(join(folder, "VERSION"), `${version}\n`);
  mkdirSync("release", { recursive: true });
  const archive = resolve(`release/Relay-${version}-headless.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, name]);
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(
    `${archive}.sha256`,
    `${digest}  Relay-${version}-headless.tar.gz\n`,
  );
  copyFileSync("packaging/headless/install.sh", "release/install-relay.sh");
  copyFileSync(
    "packaging/headless/install-relay.ps1",
    "release/install-relay.ps1",
  );
  console.log(archive);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
