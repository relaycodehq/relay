/** A response body past the caller's size limit. */
export class ResponseTooLarge extends Error {}

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
