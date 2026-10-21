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

/**
 * One shared event connection. Each request rediscovers the service and its
 * credential, so an external restart or password rotation needs no Relay restart.
 * There are no automatic write retries: a lost reply may already have applied.
 */
export const openCodeClient = OpenCode.make({
  baseUrl: "http://opencode.invalid",
  fetch: async (input, init) => {
    const { url, password } = await openCodeEndpoint();
    const path = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    );
    // Waiting for execution can outlast an ordinary request; the caller owns cancellation.
    const longLived =
      path.pathname === "/api/event" ||
      path.pathname.endsWith("/log") ||
      path.pathname.endsWith("/wait");
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
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new OpenCodeHttpError(response.status);
    }
    return response;
  },
});

export type NativeClient = typeof openCodeClient;
