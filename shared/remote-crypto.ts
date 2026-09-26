/**
 * The phone remote's encrypted channel, shaped like Noise NK: the phone knows
 * the desktop's static key from the QR code, both sides add a fresh ephemeral
 * key, and every later frame is sealed with ChaCha20-Poly1305. Only the holder
 * of the desktop's secret key can read what the phone sends, and a recorded
 * session can't be replayed because the desktop's ephemeral key differs each
 * time. Pure JS (noble), so the phone and the desktop run the same code.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { remoteProtocol, type HelloFrame } from "./remote";

const salt = utf8ToBytes("relay-remote/1");

export interface KeyPair {
  secret: Uint8Array;
  public: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const secret = randomBytes(32);
  return { secret, public: x25519.getPublicKey(secret) };
}

export const publicKeyOf = (secret: Uint8Array) => x25519.getPublicKey(secret);

/** Sealed frames in one direction each; a frame out of order fails to open. */
export class Channel {
  private sent = 0;
  private received = 0;
  constructor(
    private sendKey: Uint8Array,
    private receiveKey: Uint8Array,
  ) {}
  seal(text: string): Uint8Array {
    return chacha20poly1305(this.sendKey, nonce(this.sent++)).encrypt(
      utf8ToBytes(text),
    );
  }
  /** Throws on a forged, reordered or replayed frame. */
  open(frame: Uint8Array): string {
    const plain = chacha20poly1305(
      this.receiveKey,
      nonce(this.received),
    ).decrypt(frame);
    this.received++;
    return decoder.decode(plain);
  }
}

/** The phone's side: send `hello`, then finish with the desktop's reply. */
export function clientHandshake(serverKey: Uint8Array) {
  const ephemeral = generateKeyPair();
  return {
    hello: hello(ephemeral.public),
    finish(reply: HelloFrame): Channel {
      const serverEphemeral = helloKey(reply);
      const keys = derive(
        dh(ephemeral.secret, serverKey),
        dh(ephemeral.secret, serverEphemeral),
        serverKey,
        ephemeral.public,
        serverEphemeral,
      );
      return new Channel(keys.toServer, keys.toClient);
    },
  };
}

/** The desktop's side: answer the phone's `hello` with one of its own. */
export function serverHandshake(staticKey: KeyPair, clientHello: HelloFrame) {
  const clientEphemeral = helloKey(clientHello);
  const ephemeral = generateKeyPair();
  const keys = derive(
    dh(staticKey.secret, clientEphemeral),
    dh(ephemeral.secret, clientEphemeral),
    staticKey.public,
    clientEphemeral,
    ephemeral.public,
  );
  return {
    hello: hello(ephemeral.public),
    channel: new Channel(keys.toClient, keys.toServer),
  };
}

function derive(
  es: Uint8Array,
  ee: Uint8Array,
  serverStatic: Uint8Array,
  clientEphemeral: Uint8Array,
  serverEphemeral: Uint8Array,
) {
  const okm = hkdf(
    sha256,
    concatBytes(es, ee),
    salt,
    concatBytes(serverStatic, clientEphemeral, serverEphemeral),
    64,
  );
  return { toServer: okm.slice(0, 32), toClient: okm.slice(32) };
}

function dh(secret: Uint8Array, peer: Uint8Array) {
  const shared = x25519.getSharedSecret(secret, peer);
  // A low-order peer key gives an all-zero secret an attacker could predict.
  if (shared.every((b) => b === 0)) throw new Error("Invalid key exchange.");
  return shared;
}

const hello = (key: Uint8Array): HelloFrame => ({
  t: "hello",
  v: remoteProtocol,
  e: toBase64Url(key),
});

function helloKey(frame: HelloFrame) {
  if (frame?.t !== "hello" || frame.v !== remoteProtocol)
    throw new Error("This Relay speaks a different remote protocol.");
  const key = fromBase64Url(frame.e);
  if (key.length !== 32) throw new Error("Invalid key exchange.");
  return key;
}

/** 4 zero bytes, then the frame counter big-endian; BigInt DataView calls aren't everywhere. */
function nonce(counter: number) {
  const n = new Uint8Array(12);
  const view = new DataView(n.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32));
  view.setUint32(8, counter >>> 0);
  return n;
}

const decoder =
  typeof TextDecoder === "function"
    ? new TextDecoder("utf-8", { fatal: true })
    : { decode: decodeUtf8 };

/** For runtimes without TextDecoder; the bytes already passed authentication. */
function decodeUtf8(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]!;
    const code =
      b < 0x80
        ? b
        : b < 0xe0
          ? ((b & 0x1f) << 6) | (bytes[i++]! & 0x3f)
          : b < 0xf0
            ? ((b & 0x0f) << 12) |
              ((bytes[i++]! & 0x3f) << 6) |
              (bytes[i++]! & 0x3f)
            : ((b & 0x07) << 18) |
              ((bytes[i++]! & 0x3f) << 12) |
              ((bytes[i++]! & 0x3f) << 6) |
              (bytes[i++]! & 0x3f);
    out += String.fromCodePoint(code);
  }
  return out;
}

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const values = new Uint8Array(128).fill(255);
for (let i = 0; i < alphabet.length; i++) values[alphabet.charCodeAt(i)] = i;
const chars = [...alphabet].map((c) => c.charCodeAt(0));

/** Buffer and btoa aren't on every runtime the phone runs in; a thread can be megabytes. */
export function toBase64Url(bytes: Uint8Array): string {
  const out = new Uint16Array(Math.ceil((bytes.length * 4) / 3));
  let o = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const count = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < count; j++) out[o++] = chars[(n >> (18 - 6 * j)) & 63]!;
  }
  let text = "";
  for (let i = 0; i < o; i += 8192)
    text += String.fromCharCode(...out.subarray(i, Math.min(o, i + 8192)));
  return text;
}

export function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error("Invalid base64url.");
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let bits = 0,
    value = 0,
    at = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? values[code]! : 255;
    if (v === 255) throw new Error("Invalid base64url.");
    value = ((value << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 255;
    }
  }
  return out;
}

export const randomToken = (bytes = 32) => toBase64Url(randomBytes(bytes));
