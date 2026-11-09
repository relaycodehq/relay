import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readSignedFeed, type FeedResponse } from "./update-feed";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const keys = [
  Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString(
    "base64",
  ),
];

const feed = Buffer.from('{"version":"1.2.3"}');
const signature = sign(null, feed, privateKey).toString("base64");

const mirror = "https://mirror.test/latest.json";
const github = "https://github.test/latest.json";

const response = (body: string | Buffer, status = 200): FeedResponse => ({
  ok: status < 300,
  status,
  arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer,
  text: async () => body.toString(),
});

/** Serves `routes` by URL and records every URL asked for. */
function server(routes: Record<string, () => FeedResponse>) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error(`Couldn't reach ${new URL(url).host}.`);
    return route();
  };
  return { get, asked };
}

const signedFeedAt = (url: string) => ({
  [url]: () => response(feed),
  [`${url}.sig`]: () => response(signature),
});

describe("readSignedFeed", () => {
  it("reads the mirror and leaves GitHub alone when the mirror answers", async () => {
    const { get, asked } = server({
      ...signedFeedAt(mirror),
      ...signedFeedAt(github),
    });
    const bytes = await readSignedFeed([mirror, github], get, keys);
    expect(Buffer.from(bytes)).toEqual(feed);
    expect(asked).toEqual([mirror, `${mirror}.sig`]);
  });

  it("falls back to GitHub when the mirror is down, failing or unsigned", async () => {
    const brokenMirrors: Record<string, () => FeedResponse>[] = [
      {},
      { [mirror]: () => response("Bad gateway", 502) },
      {
        [mirror]: () => response(feed),
        [`${mirror}.sig`]: () => response("", 404),
      },
      {
        [mirror]: () => response('{"version":"9.9.9"}'),
        [`${mirror}.sig`]: () => response(signature),
      },
    ];
    for (const broken of brokenMirrors) {
      const { get } = server({ ...broken, ...signedFeedAt(github) });
      const bytes = await readSignedFeed([mirror, github], get, keys);
      expect(Buffer.from(bytes)).toEqual(feed);
    }
  });

  it("says why the last source failed when none answers", async () => {
    const { get } = server({ [mirror]: () => response("Bad gateway", 502) });
    await expect(readSignedFeed([mirror, github], get, keys)).rejects.toThrow(
      "Couldn't reach github.test.",
    );
  });
});
