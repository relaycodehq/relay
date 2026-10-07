import { expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyFile } from "./secrets";

it("seals with a key it makes once, readable only by this user", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-key-")));
  try {
    const file = join(dir, "home", "secret.key");
    const sealed = new KeyFile(file).encrypt("device token");
    expect(sealed.toString("utf8")).not.toContain("device token");
    // Another start reads the same key back.
    expect(new KeyFile(file).decrypt(sealed)).toBe("device token");
    if (process.platform !== "win32")
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(
      Buffer.from((await readFile(file, "utf8")).trim(), "base64"),
    ).toHaveLength(32);

    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => new KeyFile(file).decrypt(tampered)).toThrow();
    expect(() =>
      new KeyFile(file).decrypt(Buffer.from("v10 from Keychain")),
    ).toThrow(/headless Relay/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
