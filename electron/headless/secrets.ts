import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const format = 1;
const ivBytes = 12;
const tagBytes = 16;

/**
 * Seals secrets for a Relay without a desktop session, where there is no
 * Keychain or Secret Service to ask: AES-256-GCM under a key kept in a file
 * only this user can read, as SSH keeps its own. Paired computers' tokens,
 * the bridge's private key and plugin secrets go through here.
 */
export class KeyFile {
  private key?: Buffer;
  constructor(private file: string) {}

  encrypt(value: string) {
    const iv = randomBytes(ivBytes);
    const cipher = createCipheriv("aes-256-gcm", this.load(), iv) as CipherGCM;
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([
      Buffer.from([format]),
      iv,
      cipher.getAuthTag(),
      body,
    ]);
  }

  decrypt(sealed: Buffer) {
    if (sealed[0] !== format || sealed.length < 1 + ivBytes + tagBytes)
      throw new Error("This secret wasn't sealed by a headless Relay.");
    const iv = sealed.subarray(1, 1 + ivBytes),
      tag = sealed.subarray(1 + ivBytes, 1 + ivBytes + tagBytes),
      body = sealed.subarray(1 + ivBytes + tagBytes);
    const decipher = createDecipheriv("aes-256-gcm", this.load(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  }

  /** Made on first use; a second Relay racing to make it reads the winner's. */
  private load() {
    if (this.key) return this.key;
    try {
      this.key = readKey(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      try {
        writeFileSync(this.file, randomBytes(32).toString("base64") + "\n", {
          mode: 0o600,
          flag: "wx",
        });
      } catch (made) {
        if ((made as NodeJS.ErrnoException).code !== "EEXIST") throw made;
      }
      this.key = readKey(this.file);
    }
    return this.key;
  }
}

function readKey(file: string) {
  const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error(`${file} doesn't hold a Relay key.`);
  return key;
}
