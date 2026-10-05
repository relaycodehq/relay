import { expect, it } from "vitest";
import {
  clientHandshake,
  generateKeyPair,
  serverHandshake,
} from "../../shared/remote-crypto";
import { jsCodec, openFrame, sealFrame } from "../../shared/remote-wire";
import { nodeCodec } from "./server";

function connect() {
  const key = generateKeyPair();
  const phone = clientHandshake(key.public);
  const desktop = serverHandshake(key, phone.hello);
  return { phone: phone.finish(desktop.hello), desktop: desktop.channel };
}

const thread = {
  t: "event",
  event: { kind: "message", body: "Read the watcher, found the race. ".repeat(200) },
};

it("reads frames the other side deflated with its own library", () => {
  const { phone, desktop } = connect();
  const fromDesktop = sealFrame(desktop, thread, true, nodeCodec);
  const fromPhone = sealFrame(phone, thread, true, jsCodec);
  expect(fromDesktop.length).toBeLessThan(JSON.stringify(thread).length / 10);
  expect(openFrame(phone, fromDesktop, jsCodec)).toEqual(thread);
  expect(openFrame(desktop, fromPhone, nodeCodec)).toEqual(thread);
});

it("still reads an older peer's text frames on a compact link", () => {
  const { phone, desktop } = connect();
  const text = sealFrame(phone, { t: "got", s: 1 }, false, jsCodec);
  expect(typeof text).toBe("string");
  expect(openFrame(desktop, text, nodeCodec)).toEqual({ t: "got", s: 1 });
  const small = sealFrame(desktop, { t: "tick" }, true, nodeCodec);
  expect(openFrame(phone, small, jsCodec)).toEqual({ t: "tick" });
});

it("won't inflate a frame into more than any real one", () => {
  const { phone, desktop } = connect();
  const bomb = { pad: "0".repeat(40 * 1024 * 1024) };
  const sealed = sealFrame(phone, bomb, true, { ...jsCodec, deflateUpTo: Infinity });
  expect(sealed.length).toBeLessThan(100_000);
  expect(() => openFrame(desktop, sealed, nodeCodec)).toThrow();
});
