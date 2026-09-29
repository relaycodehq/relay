// Pins what Relay downloads for the Cursor SDK: the versions, tarballs and
// hashes of @cursor/sdk and everything it needs, read from package-lock.json.
// Relay never ships the SDK; it fetches these on first use (see
// electron/agents/cursor/sdk-install.ts). Run after bumping @cursor/sdk:
//   npm install --save-dev @cursor/sdk@<version>  &&  node scripts/update-cursor-sdk.mjs
import { readFileSync, writeFileSync } from "node:fs";

const packages = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;
const root = "node_modules/@cursor/sdk";
if (!packages[root]) throw new Error("@cursor/sdk isn't in package-lock.json.");

/** Where Node would find `name` for the package at `from`: its own node_modules, then each parent's. */
function locate(from, name) {
  for (let base = from; ;) {
    const candidate = `${base ? base + "/" : ""}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    const up = base.lastIndexOf("/node_modules/");
    if (up < 0) {
      if (!base) return undefined;
      base = "";
    } else base = base.slice(0, up);
  }
}

const closure = new Map();
(function walk(path) {
  if (closure.has(path)) return;
  const entry = packages[path];
  closure.set(path, entry);
  for (const name of Object.keys({
    ...entry.dependencies,
    ...entry.optionalDependencies,
  })) {
    const found = locate(path, name);
    if (found) walk(found);
  }
})(root);

const sdk = packages[root];
const lock = {
  sdk: sdk.version,
  node: sdk.engines?.node,
  /** A newer SDK is only installed when it asks for these same dependencies. */
  dependencies: sdk.dependencies,
  packages: Object.fromEntries(
    [...closure]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, entry]) => [
        path,
        {
          version: entry.version,
          resolved: entry.resolved,
          integrity: entry.integrity,
          ...(entry.os ? { os: entry.os } : {}),
          ...(entry.cpu ? { cpu: entry.cpu } : {}),
        },
      ]),
  ),
};
writeFileSync(
  "packaging/cursor-sdk.lock.json",
  JSON.stringify(lock, null, 2) + "\n",
);
console.log(`Pinned @cursor/sdk ${lock.sdk} and ${closure.size - 1} more.`);
