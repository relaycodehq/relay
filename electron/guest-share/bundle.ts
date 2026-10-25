import type { GuestBundle } from "../../shared/guest-share";
import { sharedFileText } from "./shared-files";
import { guestAuthor, guestBody, type GuestSnapshot } from "./snapshot";

/**
 * The conversation and its shared files as a guest's own Relay carries them
 * on: the same redacted text the page shows, as markdown.
 */
export async function guestBundle(
  snapshot: GuestSnapshot,
): Promise<GuestBundle> {
  const files = await Promise.all(
    [...snapshot.files.values()].map(async (file) => {
      const content = await sharedFileText(file).catch(() => undefined);
      return content === undefined ? [] : [{ path: file.path, content }];
    }),
  );
  return {
    title: snapshot.view.title,
    messages: snapshot.conversation
      .filter((m) => m.status !== "streaming")
      .map((m) => ({
        role: m.role,
        from: guestAuthor(m),
        body: guestBody(m.body),
        created: m.created,
      })),
    files: files.flat(),
  };
}
