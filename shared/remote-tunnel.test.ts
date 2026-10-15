import { expect, it } from "vitest";
import {
  clientHandshake,
  generateKeyPair,
  serverHandshake,
} from "./remote-crypto";
import {
  decodeTunnel,
  encodeTunnel,
  tunnelChunk,
  type TunnelFrame,
} from "./remote-tunnel";
import {
  isTunnel,
  jsCodec,
  openFrame,
  sealFrame,
  sealTunnel,
} from "./remote-wire";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (text: string) => new TextEncoder().encode(text);

// The Android app's TunnelFrameTest holds the same bytes.
const vectors: [TunnelFrame, string][] = [
  [{ op: "open", stream: 1, port: 5177 }, "0201000000011439"],
  [{ op: "opened", stream: 0xdeadbeef }, "0202deadbeef"],
  [
    { op: "data", stream: 2, data: utf8("GET / HTTP/1.1\r\n") },
    "020300000002474554202f20485454502f312e310d0a",
  ],
  [{ op: "credit", stream: 3, bytes: 65536 }, "02050000000300010000"],
  [{ op: "end", stream: 4 }, "020600000004"],
  [
    { op: "close", stream: 5, reason: "Nothing ✓" },
    "0207000000054e6f7468696e6720e29c93",
  ],
];

it("lays tunnel frames out byte for byte as the phone reads them", () => {
  for (const [frame, bytes] of vectors) {
    expect(hex(encodeTunnel(frame))).toBe(bytes);
    expect(decodeTunnel(encodeTunnel(frame))).toEqual(frame);
  }
});

it("refuses frames no Relay writes", () => {
  const bad = [
    "01",
    "020100000001",
    "02010000000114",
    "0208000000",
    "020800000001",
    "0202000000010000",
    "020300000001",
    "02050000000100",
  ];
  for (const frame of bad)
    expect(() =>
      decodeTunnel(
        Uint8Array.from(frame.match(/../g)!, (b) => parseInt(b, 16)),
      ),
    ).toThrow();
  const tooBig = new Uint8Array(6 + tunnelChunk + 1);
  tooBig.set([2, 3]);
  expect(() => decodeTunnel(tooBig)).toThrow();
});

it("rides the sealed channel beside JSON frames, in order", () => {
  const key = generateKeyPair();
  const phone = clientHandshake(key.public);
  const desktop = serverHandshake(key, phone.hello);
  const toPhone = phone.finish(desktop.hello);
  const data = new Uint8Array(tunnelChunk).fill(7);
  const sealed = [
    sealFrame(desktop.channel, { t: "tick" }, true, jsCodec),
    sealTunnel(desktop.channel, { op: "data", stream: 9, data }),
    sealFrame(desktop.channel, { t: "tick", hosts: [] }, true, jsCodec),
  ];
  const opened = sealed.map((f) => openFrame(toPhone, f, jsCodec));
  expect(opened[0]).toEqual({ t: "tick" });
  expect(isTunnel(opened[1]) && opened[1].frame).toEqual({
    op: "data",
    stream: 9,
    data,
  });
  expect(opened[2]).toEqual({ t: "tick", hosts: [] });
  // A JSON frame can't pass for one.
  expect(isTunnel({ t: "tunnel", frame: { op: "open" } })).toBe(false);
});
