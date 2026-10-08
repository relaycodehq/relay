import { afterEach, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as archive from "./archive";
import { replaceInstallation } from "./install";
import { lockPath } from "./lock";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanup.length) await cleanup.pop()!();
});
async function fixture() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "relay-install-test-")),
  );
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "relay"),
    staged = join(dir, "relay-2.0.0");
  for (const [path, version] of [
    [root, "1.0.0"],
    [staged, "2.0.0"],
  ]) {
    await mkdir(join(path!, "lib"), { recursive: true });
    await writeFile(join(path!, "VERSION"), version!);
    await writeFile(join(path!, "lib", "relay.cjs"), "// fixture");
  }
  return { root, staged };
}

it("restores the previous install when the replacement rename fails", async () => {
  const { root, staged } = await fixture();
  const original = archive.renameSoon;
  vi.spyOn(archive, "renameSoon").mockImplementation(async (from, to) => {
    if (from === staged) throw new Error("Injected swap failure");
    return original(from, to);
  });
  await expect(replaceInstallation(root, staged, "2.0.0")).rejects.toThrow(
    "Injected swap failure",
  );
  expect(await readFile(join(root, "VERSION"), "utf8")).toBe("1.0.0");
  expect(existsSync(join(staged, "VERSION"))).toBe(true);
  expect(existsSync(`${root}.update.lock`)).toBe(false);
});

it("shares one installation lock with bootstrap installers and updaters", async () => {
  const { root, staged } = await fixture();
  const release = await lockPath(`${root}.update`);
  cleanup.push(release);
  await expect(
    replaceInstallation(root, staged, "2.0.0", "1.0.0"),
  ).rejects.toMatchObject({ code: "ELOCKED" });
  expect(await readFile(join(root, "VERSION"), "utf8")).toBe("1.0.0");
  expect(existsSync(join(staged, "VERSION"))).toBe(true);
  await release();
  expect(await replaceInstallation(root, staged, "2.0.0", "1.0.0")).toBe(true);
  expect(await readFile(join(root, "VERSION"), "utf8")).toBe("2.0.0");
});

it("checks the staged release before moving any existing install", async () => {
  const { root, staged } = await fixture();
  await rm(join(staged, "lib", "relay.cjs"));
  await expect(replaceInstallation(root, staged, "2.0.0")).rejects.toThrow(
    "isn't a headless Relay",
  );
  expect(await readFile(join(root, "VERSION"), "utf8")).toBe("1.0.0");
});

it("does not replace an installation changed by another updater", async () => {
  const { root, staged } = await fixture();
  await writeFile(join(root, "VERSION"), "3.0.0");
  await expect(
    replaceInstallation(root, staged, "2.0.0", "1.0.0"),
  ).rejects.toThrow("installation changed");
  expect(await readFile(join(root, "VERSION"), "utf8")).toBe("3.0.0");
});
