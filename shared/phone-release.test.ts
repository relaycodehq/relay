import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { fetchNewestApp, offersNewer, pickApk } from "./phone-release";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString("base64");

const apk = {
  name: "Relay-Android.apk",
  url: "https://github.com/relaycodehq/relay/releases/download/v0.10.2/Relay-Android.apk",
  sha512: "A".repeat(86) + "==",
  size: 57_000_000,
  version: "0.10.0",
  runtime: "abc",
};

/** Serves `feed` as latest.json, signed by the test key unless `signature` says otherwise. */
function serve(feed: unknown, signature?: string | null) {
  const bytes = Buffer.from(JSON.stringify(feed, null, 2) + "\n");
  const sig = signature === undefined ? sign(null, bytes, privateKey).toString("base64") : signature;
  return async (url: string) => {
    const body = url.endsWith(".sig") ? sig : bytes;
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      arrayBuffer: async () => new Uint8Array(body as Buffer).buffer,
      text: async () => String(body),
    };
  };
}

describe("the newest app, from the release feed", () => {
  it("takes the APK beside the desktop's files, with the APK's own version", async () => {
    const newest = await fetchNewestApp(serve({ version: "0.10.2", files: {}, android: apk }), {
      keys: [key],
    });
    expect(newest).toEqual({
      release: "0.10.2",
      version: "0.10.0",
      url: apk.url,
      sha512: apk.sha512,
      size: apk.size,
    });
  });

  it("falls back to the release's own APK for feeds from before", async () => {
    const newest = await fetchNewestApp(serve({ version: "0.9.1", files: {} }), { keys: [key] });
    expect(newest).toEqual({
      release: "0.9.1",
      version: "0.9.1",
      url: "https://github.com/relaycodehq/relay/releases/download/v0.9.1/Relay-Android.apk",
    });
  });

  it("refuses a feed that isn't signed by a pinned key", async () => {
    const feed = { version: "0.10.2", files: {}, android: apk };
    await expect(fetchNewestApp(serve(feed, null), { keys: [key] })).rejects.toThrow(/answered 404/);
    await expect(fetchNewestApp(serve(feed, "A".repeat(86) + "=="), { keys: [key] })).rejects.toThrow(
      /doesn't check out/,
    );
    // The real pins don't know the test key.
    await expect(fetchNewestApp(serve(feed))).rejects.toThrow(/doesn't check out/);
  });

  it("refuses an APK on plain HTTP even when signed", async () => {
    const feed = { version: "0.10.2", files: {}, android: { ...apk, url: apk.url.replace("https", "http") } };
    await expect(fetchNewestApp(serve(feed), { keys: [key] })).rejects.toThrow(/can't read/);
  });
});

describe("offering it", () => {
  it("offers only a newer APK", () => {
    expect(offersNewer({ version: "0.10.0" }, { apk: "0.9.1", running: "0.9.1" })).toBe(true);
    expect(offersNewer({ version: "0.9.1" }, { apk: "0.9.1", running: "0.9.1" })).toBe(false);
    expect(offersNewer({ version: "0.9.0" }, { apk: "0.9.1", running: "0.9.1" })).toBe(false);
    expect(offersNewer(undefined, { apk: "0.9.1", running: "0.9.1" })).toBe(false);
  });

  it("never offers an APK whose code is older than what the desktop sent", () => {
    expect(offersNewer({ version: "0.10.0" }, { apk: "0.9.1", running: "0.10.3" })).toBe(false);
    expect(offersNewer({ version: "0.10.3" }, { apk: "0.9.1", running: "0.10.3" })).toBe(true);
  });

  it("shows one APK when the desktop and the feed both have one", () => {
    const desktop = { version: "0.11.0", from: "desktop" };
    const feed = { version: "0.10.0", from: "feed" };
    expect(pickApk(desktop, feed)).toBe(desktop);
    expect(pickApk({ ...desktop, version: "0.10.0" }, feed)).toBe(feed);
    expect(pickApk({ ...desktop, version: "0.9.0" }, feed)).toBe(feed);
    expect(pickApk(undefined, feed)).toBe(feed);
    expect(pickApk(desktop, undefined)).toBe(desktop);
  });
});
