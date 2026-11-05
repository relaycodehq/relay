import { session, type Session } from "electron";
import { copyCookies } from "./cookies";
import type { PreviewTarget } from "./preview-state";

const prepared = new WeakSet<Session>();

/** Pages in a preview ask for nothing but the clipboard and full screen. */
function prepare(ses: Session) {
  if (prepared.has(ses)) return;
  prepared.add(ses);
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowed.has(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

/** The target's browser session, seeded with the checkout's cookies the first time. */
export async function preparePreviewSession(target: PreviewTarget) {
  const ses = session.fromPartition(target.partition);
  prepare(ses);
  if (target.partition !== target.checkoutPartition) {
    const checkout = session.fromPartition(target.checkoutPartition);
    if (!(await ses.cookies.get({})).length)
      await copyCookies(checkout, ses).catch((e) =>
        console.warn("Copying the checkout's cookies failed:", e),
      );
  }
}
