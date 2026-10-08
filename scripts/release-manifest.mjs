// Writes latest.json, the update feed the app polls, from a folder of release files.
// Usage: node scripts/release-manifest.mjs <dir> <version> <owner/repo> [notes]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, repo, notes = ""] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !repo)
  throw new Error(
    "Usage: release-manifest.mjs <dir> <version> <owner/repo> [notes]",
  );

// Keep in step with UpdateTarget in shared/updates.ts.
const targets = {
  "mac-arm64": `Relay-${version}-mac-arm64.zip`,
  "win-x64": `Relay-${version}-win-x64.exe`,
  "linux-x64-appimage": `Relay-${version}-linux-x86_64.AppImage`,
  "linux-x64-omarchy": `Relay-${version}-omarchy-x86_64.tar.gz`,
};
const present = new Set(readdirSync(dir));
const files = {};
for (const [target, name] of Object.entries(targets)) {
  if (!present.has(name)) continue;
  const path = join(dir, name);
  files[target] = {
    name,
    url: `https://github.com/${repo}/releases/download/v${version}/${name}`,
    sha512: createHash("sha512").update(readFileSync(path)).digest("base64"),
    size: statSync(path).size,
  };
}
for (const required of [
  "mac-arm64",
  "win-x64",
  "linux-x64-appimage",
  "linux-x64-omarchy",
])
  if (!files[required])
    throw new Error(`Missing release file for ${required}.`);

writeFileSync(
  join(dir, "latest.json"),
  JSON.stringify(
    {
      version,
      published: new Date().toISOString(),
      notes: notes.slice(0, 4000),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(`latest.json → ${version}: ${Object.keys(files).join(", ")}`);
