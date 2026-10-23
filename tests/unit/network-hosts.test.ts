import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// docs/network.md promises it lists every host Relay's code names; this keeps
// that true. A new host fails here until the page says what it's for.

const root = resolve(__dirname, "../..");
const folders = ["electron", "shared", "src"];
const urlHost = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

// Reserved for examples and loopback, so never a real destination.
const notReal = (host: string) =>
  host === "localhost" ||
  /^\d+(\.\d+){3}$/.test(host) ||
  /(^|\.)(example\.com|invalid|w3\.org)$/.test(host);

function namedInCode() {
  const hosts = new Map<string, string>();
  for (const folder of folders)
    for (const entry of readdirSync(join(root, folder), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.(ts|tsx|css|html)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const file = join(entry.parentPath, entry.name);
      for (const [, found] of readFileSync(file, "utf8").matchAll(urlHost)) {
        const host = found.toLowerCase().replace(/\.+$/, "");
        if (!notReal(host) && !hosts.has(host))
          hosts.set(host, relative(root, file));
      }
    }
  return hosts;
}

/** The backticked hosts in the first column of the page's tables. */
function listedInDocs() {
  const page = readFileSync(join(root, "docs/network.md"), "utf8");
  const hosts = new Set<string>();
  for (const line of page.split("\n")) {
    const first = /^\|([^|]*)\|/.exec(line)?.[1];
    for (const [, host] of first?.matchAll(/`([^`]+)`/g) ?? [])
      hosts.add(host.toLowerCase());
  }
  return hosts;
}

describe("docs/network.md", () => {
  const code = namedInCode();
  const docs = listedInDocs();

  it("lists every host the code names", () => {
    const missing = [...code]
      .filter(([host]) => !docs.has(host))
      .map(([host, file]) => `${host} (${file})`);
    expect(missing).toEqual([]);
  });

  it("lists no host the code has stopped naming", () => {
    expect([...docs].filter((host) => !code.has(host))).toEqual([]);
  });
});
