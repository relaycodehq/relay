/**
 * The phone's port tunnel, `adb reverse` over the bridge: the phone listens
 * on its own loopback and carries each TCP connection it takes to the same
 * port on the desktop's loopback, as a stream of binary frames inside the
 * encrypted channel. Raw TCP, so HTTP, keep-alive and WebSockets all pass.
 * Only the phone opens streams; the desktop connects to nothing but its own
 * loopback, and never to the bridge's port.
 *
 * A tunnel frame is sealed like any compact frame (./remote-wire), its flag
 * byte `tunnelFlag`, then an op byte, the stream's id (u32 big-endian) and
 * what the op carries:
 *
 *   1 open    phone → desktop  the port, u16 big-endian
 *   2 opened  desktop → phone  nothing; data may flow both ways
 *   3 data    both ways        1 to `tunnelChunk` bytes
 *   4 packed  both ways        the same, raw DEFLATE
 *   5 credit  both ways        u32: bytes consumed since the last credit
 *   6 end     both ways        nothing; the sender's side is done (TCP FIN)
 *   7 close   both ways        UTF-8 reason, empty for none; the stream is
 *                              gone both ways. Also an `open`'s refusal.
 *
 * Flow control: a side may have at most `tunnelWindow` bytes of a stream's
 * data (counted unpacked) that the other hasn't consumed, which means written
 * to its own socket; `credit` gives consumed bytes back. A side that is sent
 * more than the window drops the stream. Frames for a stream a side no longer
 * has are ignored: they cross a `close` on the wire.
 */
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeUtf8Bytes } from "./remote-crypto";

/** The wire's frame flag for tunnel frames, beside JSON as is (0) and deflated (1). */
export const tunnelFlag = 2;
/** The most of one stream's data either side holds unconsumed. */
export const tunnelWindow = 256 * 1024;
/** The most data one frame carries. */
export const tunnelChunk = 32 * 1024;
/** Streams one phone may have open at once. */
export const maxTunnelStreams = 24;
const maxReason = 500;

export type TunnelFrame =
  | { op: "open"; stream: number; port: number }
  | { op: "opened"; stream: number }
  | { op: "data" | "packed"; stream: number; data: Uint8Array }
  | { op: "credit"; stream: number; bytes: number }
  | { op: "end"; stream: number }
  | { op: "close"; stream: number; reason: string };

const ops = [
  "open",
  "opened",
  "data",
  "packed",
  "credit",
  "end",
  "close",
] as const satisfies readonly TunnelFrame["op"][];

/** The frame's plain bytes, flag first, ready to seal. */
export function encodeTunnel(frame: TunnelFrame): Uint8Array {
  const body =
    frame.op === "open"
      ? u16(frame.port)
      : frame.op === "credit"
        ? u32(frame.bytes)
        : frame.op === "data" || frame.op === "packed"
          ? frame.data
          : frame.op === "close"
            ? utf8ToBytes(frame.reason.slice(0, maxReason))
            : new Uint8Array(0);
  const plain = new Uint8Array(6 + body.length);
  plain[0] = tunnelFlag;
  plain[1] = ops.indexOf(frame.op) + 1;
  new DataView(plain.buffer).setUint32(2, frame.stream >>> 0);
  plain.set(body, 6);
  return plain;
}

/** Throws on a frame that isn't one: a sender that writes those isn't Relay. */
export function decodeTunnel(plain: Uint8Array): TunnelFrame {
  if (plain.length < 6 || plain[0] !== tunnelFlag)
    throw new Error("Not a tunnel frame.");
  const op = ops[plain[1]! - 1];
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const stream = view.getUint32(2);
  const body = plain.subarray(6);
  const sized = (length: number) => {
    if (body.length !== length) throw new Error(`Bad tunnel ${op}.`);
  };
  switch (op) {
    case "open":
      sized(2);
      return { op, stream, port: view.getUint16(6) };
    case "credit":
      sized(4);
      return { op, stream, bytes: view.getUint32(6) };
    case "data":
    case "packed":
      if (!body.length || body.length > tunnelChunk)
        throw new Error("Bad tunnel data.");
      return { op, stream, data: body };
    case "opened":
    case "end":
      sized(0);
      return { op, stream };
    case "close":
      return { op, stream, reason: decodeUtf8Bytes(body) };
    default:
      throw new Error("Unknown tunnel frame.");
  }
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0);
  return bytes;
}

/** A dev server a phone can open through the tunnel: a project's task listening on `port`. */
export interface RemoteSite {
  port: number;
  /** What it is, e.g. "Vite dev server". */
  title: string;
  command: string;
  projectId: string;
  project: string;
  /** The thread whose agent or terminal started it. */
  chatId?: string;
  /** Runs in a thread's worktree rather than the project's checkout. */
  worktree?: boolean;
}
