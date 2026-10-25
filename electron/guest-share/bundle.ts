import {
  BUNDLE_AUTHOR_CHARS,
  BUNDLE_TITLE_CHARS,
  type GuestBundle,
} from "../../shared/guest-share";
import { sharedFileText } from "./shared-files";
import {
  guestAuthor,
  guestBody,
  withoutHostPaths,
  type GuestSnapshot,
} from "./snapshot";

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
    // Cut to what an import takes, so a long name doesn't make it refuse the lot.
    title: snapshot.view.title.slice(0, BUNDLE_TITLE_CHARS),
    messages: snapshot.conversation
      .filter((m) => m.status !== "streaming")
      .map((m) => ({
        role: m.role,
        from: guestAuthor(m).slice(0, BUNDLE_AUTHOR_CHARS),
        body: withoutHostPaths(guestBody(m.body), snapshot.root),
        created: m.created,
      })),
    files: files.flat(),
  };
}
