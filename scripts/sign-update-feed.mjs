// Signs latest.json for the updater: an Ed25519 signature over its exact bytes,
// base64, written next to it as latest.json.sig. Installed apps refuse a feed
// whose signature doesn't check out against updateKeys in shared/updates.ts,
// so this refuses a key that isn't one of them.
//
//   node scripts/sign-update-feed.mjs <latest.json>   writes <latest.json>.sig
//   node scripts/sign-update-feed.mjs --check         only checks the key
//
// --key <pem> reads another private key (PKCS#8 PEM) than the Mac mini's;
// --pinned <base64> trusts that public key instead of updateKeys (tests only).
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  if (!value) fail(`${name} needs a value.`);
  return value;
};
const keyPath =
  option("--key") ??
  join(homedir(), ".config", "relay-ci", "update-signing-key.pem");
const pinnedOverride = option("--pinned");
const check = args.includes("--check");
const feed = args.find((arg) => arg !== "--check");
if (!check && !feed)
  fail("Usage: sign-update-feed.mjs <latest.json> | --check [--key <pem>]");

/** updateKeys as written in shared/updates.ts. */
function pinnedKeys() {
  const source = readFileSync(
    new URL("../shared/updates.ts", import.meta.url),
    "utf8",
  );
  const list = /export const updateKeys[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1];
  const keys = [...(list ?? "").matchAll(/"([A-Za-z0-9+/]{43}=)"/g)].map(
    (match) => match[1],
  );
  if (!keys.length) fail("Couldn't read updateKeys from shared/updates.ts.");
  return keys;
}

if (!existsSync(keyPath))
  fail(
    `No update signing key at ${keyPath}. Without it this release can't be signed, and installs would refuse it.`,
  );
let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(keyPath));
} catch {
  fail(`${keyPath} isn't a PEM private key.`);
}
if (privateKey.asymmetricKeyType !== "ed25519")
  fail(`${keyPath} isn't an Ed25519 key.`);
const publicKey = createPublicKey(privateKey);
const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
const ours = raw.toString("base64");
const pinned = pinnedOverride ? [pinnedOverride] : pinnedKeys();
if (!pinned.includes(ours))
  fail(
    `The signing key's public key ${ours} isn't in updateKeys (shared/updates.ts), so installs would refuse what it signs.`,
  );

const data = check ? Buffer.from("relay update key check") : readFileSync(feed);
const signature = sign(null, data, privateKey);
if (!verify(null, data, publicKey, signature))
  fail("The signature didn't verify.");
if (check) {
  console.log(`Update signing key ${ours} is pinned.`);
} else {
  writeFileSync(`${feed}.sig`, signature.toString("base64"));
  console.log(`Signed ${feed} with ${ours}.`);
}
