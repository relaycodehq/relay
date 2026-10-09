import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { signedByAny } from "../../shared/update-signature";

const run = promisify(execFile);
const script = "scripts/sign-update-feed.mjs";

/** A throwaway signing key on disk, as the Mac mini keeps its own. */
async function signingKey(dir: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = join(dir, "update-signing-key.pem");
  await writeFile(pem, privateKey.export({ format: "pem", type: "pkcs8" }));
  const x = publicKey.export({ format: "jwk" }).x!;
  return { pem, key: Buffer.from(x, "base64url").toString("base64") };
}

async function feedIn(dir: string) {
  const feed = join(dir, "latest.json");
  await writeFile(feed, JSON.stringify({ version: "0.9.0", files: {} }) + "\n");
  return feed;
}

const sign = (...args: string[]) =>
  run(process.execPath, [script, ...args]).then(
    (done) => ({ code: 0, out: done.stdout + done.stderr }),
    (failed: { code: number; stdout: string; stderr: string }) => ({
      code: failed.code,
      out: failed.stdout + failed.stderr,
    }),
  );

describe("signing the update feed", () => {
  it("writes a signature the updater accepts, and only for those bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-sign-"));
    const { pem, key } = await signingKey(dir);
    const feed = await feedIn(dir);
    const result = await sign(feed, "--key", pem, "--pinned", key);
    expect(result).toMatchObject({ code: 0 });
    const bytes = await readFile(feed);
    const signature = await readFile(`${feed}.sig`, "utf8");
    expect(signedByAny(bytes, signature, [key])).toBe(true);
    bytes[bytes.length - 2] ^= 1;
    expect(signedByAny(bytes, signature, [key])).toBe(false);
  });

  it("refuses a key that isn't in updateKeys, before signing anything", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-sign-"));
    const { pem } = await signingKey(dir);
    const feed = await feedIn(dir);
    // Without --pinned it reads the list the app ships, and this key isn't on it.
    const result = await sign(feed, "--key", pem);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("isn't in updateKeys");
    expect(existsSync(`${feed}.sig`)).toBe(false);
    expect((await sign("--check", "--key", pem)).code).not.toBe(0);
  });

  it("fails without a key, so the release stops before publishing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-sign-"));
    const feed = await feedIn(dir);
    const missing = join(dir, "no-such-key.pem");
    const result = await sign(feed, "--key", missing);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("No update signing key");
    expect(existsSync(`${feed}.sig`)).toBe(false);
    expect((await sign("--check", "--key", missing)).code).not.toBe(0);
  });
});
