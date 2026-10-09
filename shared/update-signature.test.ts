import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { signedByAny } from "./update-signature";
import { updateKeys } from "./updates";

/** A key pair as the release build has one: raw public key in base64. */
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x!;
  return { privateKey, key: Buffer.from(x, "base64url").toString("base64") };
}

const feed = Buffer.from(
  JSON.stringify({ version: "0.9.0", files: {} }, null, 2) + "\n",
);
const release = keyPair();
const signature = sign(null, feed, release.privateKey).toString("base64");

describe("update feed signature", () => {
  it("accepts the release key's signature over the exact bytes", () => {
    expect(signedByAny(feed, signature, [release.key])).toBe(true);
    // As a file served with a trailing newline.
    expect(signedByAny(feed, `${signature}\n`, [release.key])).toBe(true);
  });

  it("refuses a feed with any byte changed", () => {
    const tampered = Buffer.from(feed);
    tampered[tampered.indexOf("9")] = "8".charCodeAt(0);
    expect(signedByAny(tampered, signature, [release.key])).toBe(false);
    // Reformatting alone breaks it too: the bytes are signed, not the JSON.
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(String(feed))));
    expect(signedByAny(reformatted, signature, [release.key])).toBe(false);
  });

  it("refuses a signature by a key that isn't pinned", () => {
    const other = keyPair();
    const forged = sign(null, feed, other.privateKey).toString("base64");
    expect(signedByAny(feed, forged, [release.key])).toBe(false);
    expect(signedByAny(feed, signature, [])).toBe(false);
  });

  it("accepts any key on the list, so a rotation can ship first", () => {
    const next = keyPair();
    const rotated = sign(null, feed, next.privateKey).toString("base64");
    expect(signedByAny(feed, rotated, [release.key, next.key])).toBe(true);
  });

  it("accepts a .sig signed by both keys while installs move over", () => {
    const next = keyPair();
    const both = `${sign(null, feed, next.privateKey).toString("base64")}\n${signature}\n`;
    expect(signedByAny(feed, both, [release.key])).toBe(true);
    expect(signedByAny(feed, both, [next.key])).toBe(true);
    expect(signedByAny(feed, both, [keyPair().key])).toBe(false);
  });

  it("refuses an empty, truncated or malformed signature", () => {
    for (const bad of [
      "",
      "not a signature",
      signature.slice(0, 40),
      "A".repeat(86) + "==",
    ])
      expect(signedByAny(feed, bad, [release.key])).toBe(false);
    expect(signedByAny(feed, signature, ["not-a-key"])).toBe(false);
  });

  it("pins well-formed keys; a typo here would strand every install", () => {
    expect(updateKeys.length).toBeGreaterThan(0);
    for (const key of updateKeys) {
      const raw = Buffer.from(key, "base64");
      expect(raw.toString("base64")).toBe(key);
      expect(raw).toHaveLength(32);
      expect(ed25519.utils.isValidPublicKey(raw, false)).toBe(true);
    }
  });

  it("verifies without Node Buffer or Web Crypto, as Hermes does", () => {
    const bytes = new Uint8Array(feed);
    const buffer = globalThis.Buffer;
    const crypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    let valid: boolean;
    try {
      Object.defineProperty(globalThis, "Buffer", {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });
      valid = signedByAny(bytes, signature, [release.key]);
    } finally {
      Object.defineProperty(globalThis, "Buffer", {
        value: buffer,
        configurable: true,
        writable: true,
      });
      if (crypto) Object.defineProperty(globalThis, "crypto", crypto);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
    expect(valid!).toBe(true);
  });
});
