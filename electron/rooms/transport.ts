import { HttpStatusError, readBounded } from "../../shared/http";

export type Network = (url: string, init?: RequestInit) => Promise<Response>;
export type RoomRequest = <T>(
  server: string,
  path: string,
  secret: string | undefined,
  method?: string,
  body?: unknown,
) => Promise<T>;

/** Asks a room server. A 428 means the server wants Gitea access proven
 * again: `reauth` does that for the session token, then the call runs once more. */
export function roomRequest(
  fetcher: Network,
  reauth: (secret: string) => Promise<boolean>,
) {
  const request = async <T>(
    server: string,
    path: string,
    secret: string | undefined,
    method = "GET",
    body?: unknown,
    retryAccess = true,
  ): Promise<T> => {
    const response = await fetcher(server + path, {
      method,
      headers: {
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const text = await readBounded(
      response,
      8_000_000,
      "Room server returned too much data.",
    );
    let value: any;
    try {
      value = JSON.parse(text);
    } catch {
      const message = "The room server returned an invalid response.";
      throw response.ok
        ? new Error(message)
        : new HttpStatusError(message, response.status);
    }
    if (
      response.status === 428 &&
      retryAccess &&
      secret &&
      (await reauth(secret))
    )
      return request<T>(server, path, secret, method, body, false);
    if (!response.ok)
      throw new HttpStatusError(
        typeof value?.error === "string"
          ? value.error.slice(0, 1000)
          : `Room server returned ${response.status}.`,
        response.status,
      );
    return value as T;
  };
  return request;
}
