import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { AVD_LIST_CACHE } from "./avd-list-cache";

// Calls avdmanager the way the hub's bundle does: an ESM import of execFile, promisified.
const HUB_LIKE = `
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
const [avdmanager, avdHome] = process.argv.slice(2);
const list = async () => (await run(avdmanager, ["list", "avd"])).stdout.trim();
const out = [];
out.push(...(await Promise.all([list(), list()])));
out.push(await list());
mkdirSync(join(avdHome, "Pixel.avd"));
out.push(await list());
await run(avdmanager, ["delete", "avd", "-n", "Pixel"]);
out.push(await list());
console.log(JSON.stringify(out));
`;

describe.skipIf(process.platform === "win32")("AVD_LIST_CACHE", () => {
  it("runs avdmanager list avd again only when the AVDs may have changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-avd-cache-"));
    const avdHome = join(dir, "avd");
    await mkdir(avdHome);
    const calls = join(dir, "calls");
    const avdmanager = join(dir, "avdmanager");
    await writeFile(avdmanager, `#!/bin/sh\necho "$*" >> "${calls}"\nwc -l < "${calls}"\n`);
    await chmod(avdmanager, 0o755);
    const cache = join(dir, "cache.mjs");
    await writeFile(cache, AVD_LIST_CACHE);
    const script = join(dir, "hub.mjs");
    await writeFile(script, HUB_LIKE);

    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", pathToFileURL(cache).href, script, avdmanager, avdHome],
      { env: { ...process.env, ANDROID_AVD_HOME: avdHome } },
    );

    // Two at once share one run, a repeat is cached, a new AVD folder and a delete each refresh it.
    expect(JSON.parse(stdout)).toEqual(["1", "1", "1", "2", "4"]);
    expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual([
      "list avd",
      "list avd",
      "delete avd -n Pixel",
      "list avd",
    ]);
  });
});
