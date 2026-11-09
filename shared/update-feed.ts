import { signedByAny } from "./update-signature";

/** What reading the feed needs of a fetch response, on the desktop and headless alike. */
export interface FeedResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/**
 * Runs `attempt` on each source in turn until one works: the mirror first,
 * GitHub when it can't answer. Throws the last source's error when none do.
 */
export async function firstThatWorks<T>(
  sources: readonly string[],
  attempt: (source: string) => Promise<T>,
): Promise<T> {
  let failure: unknown = new Error("There's nowhere to get the update from.");
  for (const source of sources) {
    try {
      return await attempt(source);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/**
 * The exact bytes of the first feed whose signature checks out against
 * `keys`. A mirror serving a feed nobody signed counts as not answering, so
 * the next source still gets its turn.
 */
export function readSignedFeed(
  feeds: readonly string[],
  get: (url: string) => Promise<FeedResponse>,
  keys: readonly string[],
): Promise<Uint8Array> {
  return firstThatWorks(feeds, async (feed) => {
    const [response, signed] = await Promise.all([
      get(feed),
      get(`${feed}.sig`),
    ]);
    if (!response.ok)
      throw new Error(`The update feed answered ${response.status}.`);
    if (!signed.ok && signed.status !== 404)
      throw new Error(`The update feed's signature answered ${signed.status}.`);
    // Nothing in the feed counts until its exact bytes check out.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = signed.ok ? await signed.text() : "";
    if (!signature.trim())
      throw new Error(
        "The update feed isn't signed, so Relay won't install from it.",
      );
    if (!signedByAny(bytes, signature, keys))
      throw new Error(
        "The update feed's signature doesn't check out, so Relay won't install from it.",
      );
    return bytes;
  });
}
