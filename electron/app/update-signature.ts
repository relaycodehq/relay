import { ed25519 } from "@noble/curves/ed25519.js";

const base64Signature = /^[A-Za-z0-9+/]{86}==$/;

/**
 * True when one of the lines in `signatures` (base64, as latest.json.sig holds
 * them) is an Ed25519 signature over exactly `feed` by one of `keys` (raw
 * public keys, base64). Several lines let a key rotation sign with both keys.
 */
export function signedByAny(
  feed: Uint8Array,
  signatures: string,
  keys: readonly string[],
) {
  const sigs = signatures
    .split(/\s+/)
    .filter((line) => base64Signature.test(line))
    .slice(0, 8)
    .map((line) => Buffer.from(line, "base64"));
  const raws = keys
    .map((key) => Buffer.from(key, "base64"))
    .filter((raw) => raw.length === 32);
  return sigs.some((sig) =>
    raws.some((raw) => {
      try {
        // Strict RFC 8032, as OpenSSL signs and checks.
        return ed25519.verify(sig, feed, raw, { zip215: false });
      } catch {
        return false;
      }
    }),
  );
}
