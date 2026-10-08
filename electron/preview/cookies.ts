import type { Session } from "electron";

/**
 * Copies every cookie from one session into another, so a worktree's preview
 * starts signed in wherever the checkout's was.
 */
export async function copyCookies(from: Session, to: Session) {
  const cookies = await from.cookies.get({});
  await Promise.all(
    cookies.map((cookie) => {
      const host = (cookie.domain ?? "").replace(/^\./, "");
      if (!host) return;
      return to.cookies
        .set({
          url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`,
          name: cookie.name,
          value: cookie.value,
          ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
          sameSite: cookie.sameSite,
        })
        .catch(() => {});
    }),
  );
}
