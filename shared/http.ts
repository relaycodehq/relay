/** A response body past the caller's size limit. */
export class ResponseTooLarge extends Error {}

/** A server's refusal, with the HTTP status that tells a retry-worthy failure from a final one. */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The server read the request and said no, so sending it again changes nothing.
 * Auth (401, 428), timeouts and rate limits (408, 425, 429) can pass; anything
 * else in the 4xx range will not. */
export function refusedForGood(error: unknown) {
  if (!(error instanceof HttpStatusError)) return false;
  const { status } = error;
  return (
    status >= 400 && status < 500 && ![401, 408, 425, 428, 429].includes(status)
  );
}

/** Reads a fetch response body as UTF-8, refusing more than `limit` bytes. */
export async function readBounded(
  response: Response,
  limit: number,
  message: string,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new ResponseTooLarge(message);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ResponseTooLarge(message);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
