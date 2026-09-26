import { expect, it } from "vitest";
import {
  clientHandshake,
  fromBase64Url,
  generateKeyPair,
  serverHandshake,
  toBase64Url,
} from "../../shared/remote-crypto";
import { pairingUrl, parsePairingUrl } from "../../shared/remote";

function connect(pinned = generateKeyPair()) {
  const phone = clientHandshake(pinned.public);
  const desktop = serverHandshake(pinned, phone.hello);
  return { phone: phone.finish(desktop.hello), desktop: desktop.channel };
}

it("carries frames both ways under the keys both sides derive", () => {
  const { phone, desktop } = connect();
  expect(desktop.open(phone.seal("pair please"))).toBe("pair please");
  expect(phone.open(desktop.seal("paired ✓"))).toBe("paired ✓");
  expect(desktop.open(phone.seal("second"))).toBe("second");
});

it("keeps a phone from talking to a desktop other than the one it pinned", () => {
  const real = generateKeyPair(),
    impostor = generateKeyPair();
  const phone = clientHandshake(real.public);
  // The impostor answers the phone's hello with its own static key.
  const fake = serverHandshake(impostor, phone.hello);
  const channel = phone.finish(fake.hello);
  expect(() => fake.channel.open(channel.seal("secret code"))).toThrow();
  expect(() => channel.open(fake.channel.seal("ready"))).toThrow();
});

it("rejects tampered, repeated and replayed frames", () => {
  const key = generateKeyPair();
  const { phone, desktop } = connect(key);
  const frame = phone.seal("send hello");
  const tampered = frame.slice();
  tampered[0]! ^= 1;
  expect(() => desktop.open(tampered)).toThrow();
  expect(desktop.open(frame)).toBe("send hello");
  expect(() => desktop.open(frame)).toThrow();

  // A recorded session played back against the desktop gets fresh keys.
  const recorded = clientHandshake(key.public);
  const first = serverHandshake(key, recorded.hello);
  const auth = recorded.finish(first.hello).seal('{"t":"auth"}');
  const replay = serverHandshake(key, recorded.hello);
  expect(() => replay.channel.open(auth)).toThrow();
});

it("encodes base64url like Node does", () => {
  for (const size of [0, 1, 2, 3, 31, 32, 33, 100]) {
    const bytes = new Uint8Array(size).map((_, i) => (i * 37 + size) % 256);
    const text = toBase64Url(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64url"));
    expect([...fromBase64Url(text)]).toEqual([...bytes]);
  }
  expect(() => fromBase64Url("a+b/")).toThrow();
});

it("reads pairing links, also when Expo Go wraps them", () => {
  const link = {
    hosts: ["192.168.1.20", "100.101.2.3"],
    port: 47821,
    key: toBase64Url(generateKeyPair().public),
    code: "c".repeat(32),
    name: "Studio Mac",
  };
  const url = pairingUrl(link);
  expect(parsePairingUrl(url)).toEqual(link);
  expect(
    parsePairingUrl("exp://10.0.2.2:8081/--/pair?" + url.split("?")[1]),
  ).toEqual(link);
  expect(parsePairingUrl(url.replace(/k=[^&]+/, "k=short"))).toBeNull();
  expect(parsePairingUrl("https://example.com")).toBeNull();
});
