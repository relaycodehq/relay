// The newest phone app as the phone finds it in the public release feed by
// itself, so it can update whatever its desktop runs, or with none around.
import { z } from "zod";
import { newerVersion } from "./phone-app";
import { decodeUtf8Bytes } from "./remote-crypto";
import { signedByAny } from "./update-signature";
import {
  releasesRepo,
  updateFeed,
  updateFileSchema,
  updateKeys,
} from "./updates";

const version = z.string().regex(/^\d+\.\d+\.\d+$/);

/** latest.json as a phone reads it: the APK sits beside the desktop's `files`. */
const phoneFeedSchema = z.object({
  version,
  android: updateFileSchema
    .extend({
      url: z.url({ protocol: /^https$/ }),
      /** The APK's own version; a release that left the native side alone carries the last APK on. */
      version,
      runtime: z.string().optional(),
    })
    .optional(),
});

export interface NewestApp {
  /** The newest Relay release. */
  release: string;
  /** The version of the app it carries. */
  version: string;
  url: string;
  /** From the signed feed; feeds from before 0.10 leave it out. */
  sha512?: string;
  size?: number;
}

/** The verified offer kept between launches; reject damaged local cache entries. */
export const newestAppSchema = updateFileSchema
  .omit({ name: true })
  .partial({ sha512: true, size: true })
  .extend({ release: version, version, url: z.url({ protocol: /^https$/ }) });

type Fetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

/** Reads the release feed and its signature; throws unless the feed is signed by a pinned key. */
export async function fetchNewestApp(
  fetch: Fetch,
  {
    feed = updateFeed,
    keys = updateKeys,
  }: { feed?: string; keys?: readonly string[] } = {},
): Promise<NewestApp> {
  const [response, signed] = await Promise.all([
    fetch(feed),
    fetch(`${feed}.sig`),
  ]);
  if (!response.ok)
    throw new Error(`The release feed answered ${response.status}.`);
  if (!signed.ok)
    throw new Error(`The release feed's signature answered ${signed.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!signedByAny(bytes, await signed.text(), keys))
    throw new Error("The release feed's signature doesn't check out.");
  let data: unknown;
  try {
    data = JSON.parse(decodeUtf8Bytes(bytes));
  } catch {}
  const parsed = phoneFeedSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("The release feed sent something Relay can't read.");
  const { android } = parsed.data;
  if (android)
    return {
      release: parsed.data.version,
      version: android.version,
      url: android.url,
      sha512: android.sha512,
      size: android.size,
    };
  // Its release carries an APK of its own version under the usual name.
  return {
    release: parsed.data.version,
    version: parsed.data.version,
    url: `https://github.com/${releasesRepo}/releases/download/v${parsed.data.version}/Relay-Android.apk`,
  };
}

/**
 * Whether to offer `newest` to an app installed as `apk` and running the code
 * of `running` (newer when its desktop sent some). Never a downgrade, and
 * never an APK whose code is older than what runs: installing it would drop
 * the desktop's code, which the desktop would only send again.
 */
export const offersNewer = (
  newest: { version: string } | undefined,
  { apk, running }: { apk: string; running: string },
) =>
  !!newest &&
  newerVersion(newest.version, apk) &&
  !newerVersion(running, newest.version);

/**
 * One APK to offer when the desktop and the feed both have one: the newer, and
 * the feed's at the same version since its download carries a checksum.
 */
export function pickApk<
  A extends { version: string },
  B extends { version: string },
>(desktop: A | undefined, feed: B | undefined): A | B | undefined {
  if (!desktop) return feed;
  if (!feed) return desktop;
  return newerVersion(desktop.version, feed.version) ? desktop : feed;
}
