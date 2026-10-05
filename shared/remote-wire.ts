/**
 * Frames on the wire. Before `compactBridge` both ways are base64url text of
 * the sealed JSON. From it they're binary: sealed, a flag byte, then the JSON,
 * deflated when that pays (raw DEFLATE, so fflate and node:zlib read each
 * other). Real threads deflate about 4x; photos, already base64 JPEG inside
 * the JSON, barely do, so big frames go as they are.
 */
import { deflateSync, inflateSync } from "fflate";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  decodeUtf8Bytes,
  fromBase64Url,
  toBase64Url,
  type Channel,
} from "./remote-crypto";

export interface Codec {
  deflate(bytes: Uint8Array): Uint8Array;
  inflate(bytes: Uint8Array): Uint8Array;
  /** Bigger frames go as they are. */
  deflateUpTo: number;
}

/** fflate: pure JS, for the phone; the desktop's server hands in node:zlib. */
export const jsCodec: Codec = {
  deflate: (bytes) => deflateSync(bytes, { level: 6 }),
  inflate: (bytes) => inflateSync(bytes),
  // Above this it's photos, which barely shrink, at the phone's CPU.
  deflateUpTo: 1024 * 1024,
};

const raw = 0;
const deflated = 1;
/** Too small to gain. */
const deflateFrom = 256;

export function sealFrame(
  channel: Channel,
  frame: unknown,
  compact: boolean,
  codec: Codec,
): string | Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(frame);
  if (!compact) return toBase64Url(channel.seal(json));
  const bytes = utf8ToBytes(json);
  let flag = raw;
  let body: Uint8Array = bytes;
  if (bytes.length >= deflateFrom && bytes.length <= codec.deflateUpTo) {
    const packed = codec.deflate(bytes);
    if (packed.length < bytes.length) {
      flag = deflated;
      body = packed;
    }
  }
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);
  // A fresh buffer, never shared; WebSocket.send's types want to know.
  return channel.seal(plain) as Uint8Array<ArrayBuffer>;
}

/** Throws on anything that doesn't open under the channel or isn't a known flag. */
export function openFrame(
  channel: Channel,
  data: string | Uint8Array,
  codec: Codec,
): unknown {
  if (typeof data === "string") return JSON.parse(channel.open(fromBase64Url(data)));
  const plain = channel.openBytes(data);
  const body = plain.subarray(1);
  if (plain[0] === raw) return JSON.parse(decodeUtf8Bytes(body));
  if (plain[0] === deflated) return JSON.parse(decodeUtf8Bytes(codec.inflate(body)));
  throw new Error("Unknown frame.");
}
