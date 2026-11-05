import { describe, expect, it, vi } from "vitest";

type RequestHandler = (
  wc: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type CheckHandler = (wc: unknown, permission: string) => boolean;

/** A session that, like Electron's, grants everything until given handlers. */
function fakeSession() {
  return {
    protocol: { handle: vi.fn() },
    request: ((_wc, _permission, callback) => callback(true)) as RequestHandler,
    check: (() => true) as CheckHandler,
    setPermissionRequestHandler(handler: RequestHandler) {
      this.request = handler;
    },
    setPermissionCheckHandler(handler: CheckHandler) {
      this.check = handler;
    },
  };
}

const defaultSession = fakeSession();
const shots = fakeSession();

vi.mock("electron", () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: { defaultSession, fromPartition: () => shots },
}));

const { serveRenders } = await import("./protocol");

describe("the zoomed shots' session", () => {
  it("grants an agent's page none of the permissions it asks for", () => {
    serveRenders(async () => "");
    for (const permission of [
      "media",
      "geolocation",
      "notifications",
      "clipboard-read",
    ]) {
      const granted = vi.fn();
      shots.request(null, permission, granted);
      expect(granted).toHaveBeenCalledWith(false);
      expect(shots.check(null, permission)).toBe(false);
    }
  });
});
