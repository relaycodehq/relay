import { OpenCode } from "@opencode/client";
import { openCodeEndpoint } from "./native-api";

let nativeFetch: typeof globalThis.fetch = (url, init) =>
  globalThis.fetch(url, init);

/** Desktop networking goes through Chromium; plain Node keeps its own fetch. */
export function configureOpenCodeFetch(fetcher: typeof globalThis.fetch) {
  nativeFetch = fetcher;
}

/** HTTP failures are deliberately free of bodies, tokens and submitted prompts. */
export class OpenCodeHttpError extends Error {
  constructor(readonly status: number) {
    super(
      `OpenCode couldn't complete this request (HTTP ${status}). Try again.`,
    );
  }
}

/** The SDK wraps whatever its fetch throws in a ClientError("Transport"), with ours as `cause`. */
export function httpStatus(error: unknown) {
  for (let e = error; e instanceof Error; e = e.cause)
    if (e instanceof OpenCodeHttpError) return e.status;
}

type Endpoint = Awaited<ReturnType<typeof openCodeEndpoint>>;
let endpoint: { at: number; value: Promise<Endpoint> } | undefined;

/** A burst of requests (recovery reads every subagent) shares one lookup, which spawns the CLI twice. */
function lookup() {
  if (!endpoint || Date.now() - endpoint.at > 10_000) {
    const entry = { at: Date.now(), value: openCodeEndpoint() };
    endpoint = entry;
    entry.value.catch(() => forget(entry));
  }
  return endpoint;
}

/** Only the lookup that failed; a newer one may already have the restarted service. */
function forget(entry: NonNullable<typeof endpoint>) {
  if (endpoint === entry) endpoint = undefined;
}

/** Node's fetch says ECONNREFUSED in its cause; Chromium's net.fetch says ERR_CONNECTION_REFUSED. */
function refusedConnection(error: unknown) {
  for (let e = error; e instanceof Error; e = e.cause)
    if (
      (e as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
      e.message.includes("ERR_CONNECTION_REFUSED")
    )
      return true;
  return false;
}

/**
 * One shared event connection. A refused credential or connection drops the
 * cached lookup and is retried once with a fresh one, since neither applied
 * anything, so an external restart or password rotation needs no Relay
 * restart. There are no other automatic retries: a lost reply may already
 * have applied.
 */
export const openCodeClient = OpenCode.make({
  baseUrl: "http://opencode.invalid",
  fetch: async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input));
    // Waiting for execution can outlast an ordinary request; the caller owns cancellation.
    const longLived =
      path.pathname === "/api/event" ||
      path.pathname.endsWith("/log") ||
      path.pathname.endsWith("/wait");
    for (let retried = false; ; retried = true) {
      const entry = lookup();
      const { url, password } = await entry.value;
      const headers = new Headers(init?.headers);
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      );
      const signal = longLived
        ? init?.signal
        : AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(
              path.pathname.endsWith("/generate") ? 120_000 : 30_000,
            ),
          ]);
      const response = await nativeFetch(
        new URL(path.pathname + path.search, url),
        {
          ...init,
          headers,
          signal,
          redirect: "error",
        },
      ).catch((error: unknown) => {
        forget(entry);
        if (retried || !refusedConnection(error)) throw error;
      });
      if (!response) continue;
      if (response.ok) return response;
      await response.body?.cancel();
      if (response.status === 401) {
        forget(entry);
        if (!retried) continue;
      }
      throw new OpenCodeHttpError(response.status);
    }
  },
});

export type NativeClient = typeof openCodeClient;
