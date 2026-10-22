import type { NativeClient } from "./client";

/**
 * A session's messages a page at a time, for `for await`. A cursor carries
 * the order it was made with, and OpenCode refuses a page that names both
 * (HTTP 400), so only the first page says which way to go.
 */
export async function* messagePages(
  client: Pick<NativeClient, "message">,
  first: { sessionID: string; order: "asc" | "desc"; limit: number },
  options?: Parameters<NativeClient["message"]["list"]>[1],
) {
  let cursor: string | undefined;
  do {
    const page = await client.message.list(
      cursor
        ? { sessionID: first.sessionID, limit: first.limit, cursor }
        : first,
      options,
    );
    yield page.data;
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
}
